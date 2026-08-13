import { prisma } from '@superdesk/db';
import { appendMessage } from '@superdesk/db/tenant';
import { serverEnv } from '@superdesk/shared/env';
import { logger } from '@superdesk/shared/logger';
import { escapeHtml, htmlToText } from '@/lib/sanitize';
import { sanitizeInboundHtml } from '@/lib/sanitize-html';

/**
 * Inbound email — parsing, threading, and the write path.
 *
 * Threading has two layers, cheapest first:
 *
 *  1. In-Reply-To / References against a Message-ID we've already seen.
 *     This is what real mail clients do and it's exact — no ambiguity about
 *     which thread a reply belongs to.
 *  2. A fallback thread key — sha256(normalized subject + contact email) —
 *     for the minority of clients that strip References on reply. Computed
 *     and stored on first contact so a later reply with equally-missing
 *     headers still lands in the same thread.
 *
 * Both read from Conversation/Message rows already scoped by workspaceId, so
 * a Message-ID collision across two different customers' workspaces (global
 * uniqueness is a Message-ID property we don't control) can't cross-thread
 * one workspace's mail into another's.
 */

export type ParsedInboundEmail = {
  providerMessageId: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
};

export type InboundProcessResult =
  | { status: 'processed'; conversationId: string }
  | { status: 'duplicate'; conversationId?: string }
  | { status: 'rejected'; reason: string };

function parseEmailAddress(raw: string): { email: string; name?: string } {
  const angle = raw.match(/<([^>]+)>/);
  if (angle) {
    const name = raw.slice(0, raw.indexOf('<')).trim().replace(/^"|"$/g, '');
    return { email: angle[1]!.trim().toLowerCase(), name: name || undefined };
  }
  return { email: raw.trim().toLowerCase() };
}

function extractLocalPart(address: string): { local: string; domain: string } | null {
  const { email } = parseEmailAddress(address);
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Exported so an agent-initiated conversation (lib/conversations.ts's
 * startConversation) can be given the same thread key up front — without
 * it, a customer's later reply-to-that-email has nothing correct to match
 * against (no In-Reply-To exists yet either, since we sent first) and
 * silently starts a second, duplicate conversation instead of threading
 * into the one the agent already opened. Found via testing, not by
 * inspection: an agent-started thread followed by a real customer reply.
 */
export async function computeThreadKey(subject: string, contactEmail: string): Promise<string> {
  const input = `${normalizeSubject(subject)}::${contactEmail.trim().toLowerCase()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Provider payload parsing
// ---------------------------------------------------------------------------

function splitReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.match(/<[^>]+>/g) ?? raw.trim().split(/\s+/).filter(Boolean);
}

/**
 * Mailgun's inbound Routes webhook — multipart/form-data with these field
 * names. (https://documentation.mailgun.com/en/latest/user_manual.html#receiving-forwarding-and-storing-messages)
 */
export function parseMailgunForm(form: FormData): ParsedInboundEmail {
  const get = (key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v : undefined;
  };

  const fromRaw = get('From') ?? get('from') ?? get('sender') ?? '';
  const { email: from, name: fromName } = parseEmailAddress(fromRaw);
  const to = get('To') ?? get('to') ?? get('recipient') ?? '';
  const subject = get('Subject') ?? get('subject') ?? '(no subject)';

  return {
    providerMessageId: get('Message-Id') ?? get('message-id') ?? crypto.randomUUID(),
    from,
    fromName,
    to,
    subject,
    html: get('body-html') ?? get('stripped-html') ?? undefined,
    text: get('body-plain') ?? get('stripped-text') ?? undefined,
    messageId: get('Message-Id') ?? undefined,
    inReplyTo: get('In-Reply-To') ?? undefined,
    references: splitReferences(get('References')),
  };
}

/**
 * Generic JSON shape — used for the take-home's own testing (no live inbound
 * mail provider is configured) and as the format a future provider adapter
 * would normalize into anyway. Field names mirror the Message model directly
 * rather than any one provider's header casing.
 */
export function parseGenericJson(body: Record<string, unknown>): ParsedInboundEmail {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const fromRaw = str(body.from) ?? '';
  const { email: from, name: parsedName } = parseEmailAddress(fromRaw);

  return {
    providerMessageId: str(body.providerMessageId) ?? crypto.randomUUID(),
    from,
    fromName: str(body.fromName) ?? parsedName,
    to: str(body.to) ?? '',
    subject: str(body.subject) ?? '(no subject)',
    html: str(body.html),
    text: str(body.text),
    messageId: str(body.messageId),
    inReplyTo: str(body.inReplyTo),
    references: Array.isArray(body.references)
      ? body.references.filter((r): r is string => typeof r === 'string')
      : splitReferences(str(body.references)),
  };
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

async function logInbound(
  parsed: ParsedInboundEmail,
  outcome: {
    workspaceId: string | null;
    status: 'processed' | 'rejected';
    reason?: string;
    conversationId?: string;
  },
): Promise<void> {
  const size = (parsed.text?.length ?? 0) + (parsed.html?.length ?? 0);
  await prisma.inboundEmailLog
    .create({
      data: {
        workspaceId: outcome.workspaceId,
        providerMessageId: parsed.providerMessageId,
        fromAddress: parsed.from,
        toAddress: parsed.to,
        subject: parsed.subject,
        messageIdHeader: parsed.messageId ?? null,
        inReplyToHeader: parsed.inReplyTo ?? null,
        status: outcome.status,
        rejectedReason: outcome.reason ?? null,
        conversationId: outcome.conversationId ?? null,
        rawSize: size,
      },
    })
    .catch((err) => {
      // Logging failure shouldn't fail the whole webhook — the email itself
      // was already processed (or correctly rejected) by this point.
      logger.error('Failed to write InboundEmailLog', err, {
        providerMessageId: parsed.providerMessageId,
      });
    });
}

async function resolveConversation(
  workspaceId: string,
  contactId: string,
  parsed: ParsedInboundEmail,
): Promise<{ conversationId: string }> {
  const candidates = [parsed.inReplyTo, ...parsed.references].filter(
    (v): v is string => Boolean(v),
  );

  if (candidates.length) {
    const match = await prisma.message.findFirst({
      where: { emailMessageId: { in: candidates }, workspaceId },
      select: { conversationId: true },
    });
    if (match) return { conversationId: match.conversationId };
  }

  const threadKey = await computeThreadKey(parsed.subject, parsed.from);
  const existing = await prisma.conversation.findFirst({
    where: { workspaceId, contactId, channel: 'EMAIL', emailThreadKey: threadKey },
    select: { id: true },
  });
  if (existing) return { conversationId: existing.id };

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      contactId,
      channel: 'EMAIL',
      subject: parsed.subject,
      emailThreadKey: threadKey,
    },
    select: { id: true },
  });
  return { conversationId: created.id };
}

export async function processInboundEmail(
  parsed: ParsedInboundEmail,
): Promise<InboundProcessResult> {
  const already = await prisma.inboundEmailLog.findUnique({
    where: { providerMessageId: parsed.providerMessageId },
    select: { conversationId: true },
  });
  if (already) {
    return { status: 'duplicate', conversationId: already.conversationId ?? undefined };
  }

  const recipient = extractLocalPart(parsed.to);
  const domainOk = recipient?.domain === serverEnv().INBOUND_EMAIL_DOMAIN;
  const workspace = recipient && domainOk
    ? await prisma.workspace.findUnique({ where: { inboundAlias: recipient.local }, select: { id: true } })
    : null;

  if (!workspace) {
    await logInbound(parsed, { workspaceId: null, status: 'rejected', reason: 'Unknown recipient address' });
    return { status: 'rejected', reason: 'Unknown recipient' };
  }

  if (!parsed.from) {
    await logInbound(parsed, { workspaceId: workspace.id, status: 'rejected', reason: 'Missing From address' });
    return { status: 'rejected', reason: 'Missing sender' };
  }

  // Backstop against a second webhook delivery carrying a different
  // provider-assigned id but the same underlying Message-ID.
  if (parsed.messageId) {
    const dup = await prisma.message.findUnique({
      where: { emailMessageId: parsed.messageId },
      select: { conversationId: true },
    });
    if (dup) {
      await logInbound(parsed, {
        workspaceId: workspace.id,
        status: 'processed',
        conversationId: dup.conversationId,
      });
      return { status: 'duplicate', conversationId: dup.conversationId };
    }
  }

  const contact = await prisma.contact.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: parsed.from } },
    update: { lastSeenAt: new Date(), ...(parsed.fromName ? { name: parsed.fromName } : {}) },
    create: { workspaceId: workspace.id, email: parsed.from, name: parsed.fromName ?? null },
    select: { id: true },
  });

  const { conversationId } = await resolveConversation(workspace.id, contact.id, parsed);

  const bodyHtml = parsed.html
    ? sanitizeInboundHtml(parsed.html)
    : escapeHtml(parsed.text ?? '').replace(/\n/g, '<br>');
  const bodyText = parsed.text?.trim() || htmlToText(parsed.html ?? '') || '(no content)';

  await appendMessage({
    conversationId,
    workspaceId: workspace.id,
    senderType: 'CONTACT',
    senderContactId: contact.id,
    bodyHtml,
    bodyText,
    emailMessageId: parsed.messageId ?? null,
    emailInReplyTo: parsed.inReplyTo ?? null,
    emailReferences: parsed.references.length ? parsed.references.join(' ') : null,
  });

  await logInbound(parsed, { workspaceId: workspace.id, status: 'processed', conversationId });

  return { status: 'processed', conversationId };
}
