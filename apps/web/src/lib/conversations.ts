import { Prisma, prisma } from '@superdesk/db';
import type { Channel, ConversationStatus } from '@superdesk/db';
import {
  appendMessage,
  markRead,
  participantKeys,
  TenantError,
  type Scope,
} from '@superdesk/db/tenant';
import { AppError } from '@superdesk/shared/errors';
import { logger } from '@superdesk/shared/logger';
import { escapeHtml } from '@/lib/sanitize';
import { sendReplyEmail } from '@/lib/email/outbound';
import { computeThreadKey } from '@/lib/email/inbound';

/**
 * Conversation management — the unified inbox's read and write paths.
 *
 * Two invariants worth flagging up front:
 *
 * 1. Every query below filters by `workspaceId` even when a conversation id
 *    is already unique on its own. A leaked id from another tenant must
 *    still 404, not 200 with someone else's data.
 * 2. Status-changing actions (assign/resolve/reopen/snooze) write directly
 *    with `prisma.conversation.update`, not through `appendMessage`.
 *    `appendMessage` has side effects tuned for *message* arrival (cancels a
 *    snooze, reopens on a contact reply) that would misfire if triggered by
 *    an unrelated action — e.g. reassigning a snoozed conversation would
 *    silently un-snooze it. The audit trail those actions leave in the
 *    thread goes through `appendSystemNote` instead, which shares the seq
 *    machinery but skips the status side effects and deliberately does not
 *    bump `lastMessageAt` — a "resolved by X" note is history, not new
 *    customer-facing activity, so it shouldn't reorder the inbox.
 */

export type ConversationFilter = {
  status?: ConversationStatus | 'ALL';
  assignee?: 'me' | 'unassigned' | (string & {});
  channel?: Channel;
  q?: string;
  cursor?: string;
  limit?: number;
};

const DEFAULT_PAGE_SIZE = 30;

/** Snoozed conversations whose wake time has passed go back to OPEN. */
async function wakeExpiredSnoozes(workspaceId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: {
      workspaceId,
      status: 'SNOOZED',
      snoozedUntil: { lte: new Date() },
    },
    data: { status: 'OPEN', snoozedUntil: null },
  });
}

export async function listConversations(scope: Scope, filter: ConversationFilter) {
  await wakeExpiredSnoozes(scope.workspaceId);

  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_PAGE_SIZE, 1), 100);

  const where: Prisma.ConversationWhereInput = {
    workspaceId: scope.workspaceId,
    ...(filter.status && filter.status !== 'ALL' ? { status: filter.status } : {}),
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.assignee === 'unassigned'
      ? { assigneeId: null }
      : filter.assignee === 'me'
        ? { assigneeId: scope.userId }
        : filter.assignee
          ? { assigneeId: filter.assignee }
          : {}),
    ...(filter.q
      ? {
          OR: [
            { subject: { contains: filter.q, mode: 'insensitive' as const } },
            { contact: { name: { contains: filter.q, mode: 'insensitive' as const } } },
            { contact: { email: { contains: filter.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      channel: true,
      status: true,
      subject: true,
      snoozedUntil: true,
      lastMessageAt: true,
      msgSeq: true,
      contact: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      messages: {
        orderBy: { seq: 'desc' },
        take: 1,
        select: { bodyText: true, senderType: true, isPrivateNote: true, createdAt: true },
      },
    },
  });

  const hasMore = conversations.length > limit;
  const page = hasMore ? conversations.slice(0, limit) : conversations;

  const readStates = page.length
    ? await prisma.readState.findMany({
        where: {
          participantKey: participantKeys.user(scope.userId),
          conversationId: { in: page.map((c) => c.id) },
        },
        select: { conversationId: true, lastReadSeq: true },
      })
    : [];
  const readBySeq = new Map(readStates.map((r) => [r.conversationId, r.lastReadSeq]));

  return {
    items: page.map((c) => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      subject: c.subject,
      snoozedUntil: c.snoozedUntil,
      lastMessageAt: c.lastMessageAt,
      contact: c.contact,
      assignee: c.assignee,
      lastMessage: c.messages[0]
        ? {
            preview: c.messages[0].bodyText.slice(0, 140),
            senderType: c.messages[0].senderType,
            isPrivateNote: c.messages[0].isPrivateNote,
            createdAt: c.messages[0].createdAt,
          }
        : null,
      unread: c.msgSeq > (readBySeq.get(c.id) ?? 0),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

async function requireConversation(scope: Scope, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: { id: true, status: true, assigneeId: true },
  });
  if (!conversation) throw new TenantError('Conversation not found');
  return conversation;
}

export async function getConversation(scope: Scope, conversationId: string) {
  await wakeExpiredSnoozes(scope.workspaceId);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: {
      id: true,
      channel: true,
      status: true,
      subject: true,
      snoozedUntil: true,
      lastMessageAt: true,
      msgSeq: true,
      createdAt: true,
      contact: { select: { id: true, name: true, email: true, metadata: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
      messages: {
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          seq: true,
          senderType: true,
          senderUserId: true,
          senderContactId: true,
          bodyHtml: true,
          bodyText: true,
          isPrivateNote: true,
          createdAt: true,
        },
      },
      summary: { select: { summary: true, upToSeq: true, degraded: true, updatedAt: true } },
    },
  });

  if (!conversation) throw new TenantError('Conversation not found');

  const readStates = await prisma.readState.findMany({
    where: { conversationId },
    select: { participantKey: true, lastReadSeq: true },
  });

  return { conversation, readStates };
}

async function appendSystemNote(
  conversationId: string,
  workspaceId: string,
  text: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: { msgSeq: { increment: 1 } },
      select: { msgSeq: true },
    });
    await tx.message.create({
      data: {
        conversationId,
        workspaceId,
        seq: updated.msgSeq,
        senderType: 'SYSTEM',
        bodyHtml: escapeHtml(text),
        bodyText: text,
      },
    });
  });
}

export async function assignConversation(
  scope: Scope,
  conversationId: string,
  assigneeId: string | null,
  actorName: string,
): Promise<void> {
  await requireConversation(scope, conversationId);

  let assigneeName = 'no one';
  if (assigneeId) {
    const member = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: assigneeId } },
      select: { user: { select: { name: true } } },
    });
    if (!member) {
      throw new AppError('BAD_REQUEST', 'That person is not a member of this workspace');
    }
    assigneeName = member.user.name;
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { assigneeId },
  });

  await appendSystemNote(
    conversationId,
    scope.workspaceId,
    assigneeId
      ? `${actorName} assigned this conversation to ${assigneeName}`
      : `${actorName} unassigned this conversation`,
  );
}

export async function resolveConversation(
  scope: Scope,
  conversationId: string,
  actorName: string,
): Promise<void> {
  await requireConversation(scope, conversationId);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'RESOLVED', resolvedAt: new Date(), snoozedUntil: null },
  });

  await appendSystemNote(conversationId, scope.workspaceId, `${actorName} marked this conversation resolved`);
}

export async function reopenConversation(
  scope: Scope,
  conversationId: string,
  actorName: string,
): Promise<void> {
  const conversation = await requireConversation(scope, conversationId);
  if (conversation.status === 'OPEN') return;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'OPEN', resolvedAt: null, snoozedUntil: null },
  });

  await appendSystemNote(conversationId, scope.workspaceId, `${actorName} reopened this conversation`);
}

const MAX_SNOOZE_DAYS = 365;

export async function snoozeConversation(
  scope: Scope,
  conversationId: string,
  until: Date,
  actorName: string,
): Promise<void> {
  await requireConversation(scope, conversationId);

  const now = Date.now();
  if (!(until.getTime() > now)) {
    throw new AppError('BAD_REQUEST', 'Pick a time in the future');
  }
  if (until.getTime() - now > MAX_SNOOZE_DAYS * 24 * 60 * 60 * 1000) {
    throw new AppError('BAD_REQUEST', `Snooze can't be more than a year out`);
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'SNOOZED', snoozedUntil: until },
  });

  await appendSystemNote(
    conversationId,
    scope.workspaceId,
    `${actorName} snoozed this conversation until ${until.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`,
  );
}

export type SendMessageInput = {
  bodyText: string;
  isPrivateNote?: boolean;
  clientMsgId?: string;
};

/**
 * Converts plain-text agent input to safe HTML.
 *
 * The compose box is plain text, not a rich editor, so there is no untrusted
 * markup to sanitize here — only to prevent from being *created* by naive
 * string concatenation. `escapeHtml` neutralizes anything that looks like a
 * tag before newlines become `<br>`.
 */
function textToSafeHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export async function sendMessage(
  scope: Scope,
  conversationId: string,
  input: SendMessageInput,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: {
      channel: true,
      subject: true,
      contact: { select: { email: true } },
    },
  });
  if (!conversation) throw new TenantError('Conversation not found');

  const bodyText = input.bodyText.trim();
  if (!bodyText) throw new AppError('BAD_REQUEST', 'Message cannot be empty');
  if (bodyText.length > 20_000) throw new AppError('BAD_REQUEST', 'Message is too long');

  // A private note never leaves the building — not into the widget (see
  // lib/widget/session.ts) and not into an outbound email either.
  const isPrivateNote = input.isPrivateNote ?? false;
  let emailThreading: { messageId?: string; inReplyTo?: string; references?: string } = {};

  if (conversation.channel === 'EMAIL' && !isPrivateNote && conversation.contact.email) {
    const [workspace, priorEmailMessages] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({
        where: { id: scope.workspaceId },
        select: { name: true, inboundAlias: true },
      }),
      prisma.message.findMany({
        where: { conversationId, emailMessageId: { not: null } },
        orderBy: { seq: 'asc' },
        select: { emailMessageId: true },
      }),
    ]);
    const references = priorEmailMessages
      .map((m) => m.emailMessageId)
      .filter((id): id is string => Boolean(id));

    try {
      const sent = await sendReplyEmail({
        workspaceName: workspace.name,
        inboundAlias: workspace.inboundAlias,
        toEmail: conversation.contact.email,
        subject: conversation.subject ? `Re: ${conversation.subject}` : 'Re: your message',
        bodyHtml: textToSafeHtml(bodyText),
        bodyText,
        inReplyTo: references.at(-1),
        references,
      });
      emailThreading = {
        messageId: sent.messageId,
        inReplyTo: references.at(-1),
        references: sent.references || undefined,
      };
    } catch (err) {
      // The reply still gets saved below even if delivery had a hiccup — an
      // agent seeing their note vanish because the email provider blipped is
      // worse than a reply that's briefly send-pending. The missing
      // emailMessageId just means this particular message won't itself be
      // resolvable as an In-Reply-To target later, which is a narrow,
      // self-correcting gap (the next successful send re-establishes it).
      logger.error('Outbound reply email failed to send', err, { conversationId });
    }
  }

  const result = await appendMessage({
    conversationId,
    workspaceId: scope.workspaceId,
    senderType: 'AGENT',
    senderUserId: scope.userId,
    bodyHtml: textToSafeHtml(bodyText),
    bodyText,
    isPrivateNote,
    clientMsgId: input.clientMsgId ?? null,
    emailMessageId: emailThreading.messageId ?? null,
    emailInReplyTo: emailThreading.inReplyTo ?? null,
    emailReferences: emailThreading.references ?? null,
  });

  // The author has, by definition, seen everything up to and including their
  // own message — advance their read cursor so it doesn't show as unread to
  // them in the list they just sent it from.
  await markRead(conversationId, participantKeys.user(scope.userId), result.message.seq);

  return result;
}

export type StartConversationInput = {
  contactEmail: string;
  contactName?: string;
  subject?: string;
  bodyText: string;
};

/**
 * Agent-initiated conversation — proactive outreach, or logging an
 * off-channel interaction (a phone call, an in-person conversation) into the
 * same inbox everything else lives in.
 *
 * This is also, for now, the only way a conversation gets created at all:
 * the chat widget and inbound email parsing are separate pieces of work not
 * built yet. Nothing about it is a placeholder, though — proactive outreach
 * is a real feature, and this is the same `appendMessage` path a chat
 * message or an inbound email will use once those exist.
 */
export async function startConversation(scope: Scope, input: StartConversationInput) {
  const email = input.contactEmail.trim().toLowerCase();
  const bodyText = input.bodyText.trim();
  if (!bodyText) throw new AppError('BAD_REQUEST', 'Message cannot be empty');

  const contact = await prisma.contact.upsert({
    where: { workspaceId_email: { workspaceId: scope.workspaceId, email } },
    update: input.contactName ? { name: input.contactName.trim() } : {},
    create: {
      workspaceId: scope.workspaceId,
      email,
      name: input.contactName?.trim() || null,
    },
    select: { id: true },
  });

  const subject = input.subject?.trim() || 'Following up';

  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: scope.workspaceId,
      contactId: contact.id,
      channel: 'EMAIL',
      subject,
      assigneeId: scope.userId,
      // Without this, a customer's later reply to this email has no
      // In-Reply-To to match yet (we sent first) and no thread key either
      // — the inbound webhook's fallback matching would find nothing and
      // silently open a second, duplicate conversation instead of
      // threading into this one. Same key the inbound path computes, so
      // either side reaching the thread first works the same way.
      emailThreadKey: await computeThreadKey(subject, email),
    },
    select: { id: true },
  });

  let emailThreading: { messageId?: string } = {};
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: scope.workspaceId },
      select: { name: true, inboundAlias: true },
    });
    const sent = await sendReplyEmail({
      workspaceName: workspace.name,
      inboundAlias: workspace.inboundAlias,
      toEmail: email,
      subject,
      bodyHtml: textToSafeHtml(bodyText),
      bodyText,
      references: [],
    });
    emailThreading = { messageId: sent.messageId };
  } catch (err) {
    // Same reasoning as sendMessage: the conversation record is more
    // important than the send succeeding synchronously.
    logger.error('Outbound proactive email failed to send', err, {
      workspaceId: scope.workspaceId,
    });
  }

  const result = await appendMessage({
    conversationId: conversation.id,
    workspaceId: scope.workspaceId,
    senderType: 'AGENT',
    senderUserId: scope.userId,
    bodyHtml: textToSafeHtml(bodyText),
    bodyText,
    emailMessageId: emailThreading.messageId ?? null,
  });

  await markRead(conversation.id, participantKeys.user(scope.userId), result.message.seq);

  return conversation.id;
}

export async function markConversationRead(
  scope: Scope,
  conversationId: string,
  lastReadSeq?: number,
): Promise<void> {
  const conversation = await requireConversation(scope, conversationId);
  const seq = lastReadSeq ?? (await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    select: { msgSeq: true },
  })).msgSeq;

  await markRead(conversationId, participantKeys.user(scope.userId), seq);
}
