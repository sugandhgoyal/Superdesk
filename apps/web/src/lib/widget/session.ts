import { prisma } from '@superdesk/db';
import { appendMessage, markRead, participantKeys } from '@superdesk/db/tenant';
import { serverEnv } from '@superdesk/shared/env';
import { AppError } from '@superdesk/shared/errors';
import { escapeHtml } from '@/lib/sanitize';
import { issueWidgetToken, verifyWidgetToken, type WidgetClaims } from './token';

export type WidgetScope = WidgetClaims;

/**
 * Verifies a widget Bearer token and confirms the contact it names still
 * exists in that workspace — the signature alone proves the token is ours,
 * not that the contact wasn't since merged or deleted.
 */
export async function authenticateWidget(token: string): Promise<WidgetScope> {
  const claims = await verifyWidgetToken(token, serverEnv().WIDGET_TOKEN_SECRET);
  if (!claims) throw new AppError('UNAUTHENTICATED', 'Invalid or expired widget session');

  const contact = await prisma.contact.findFirst({
    where: { id: claims.contactId, workspaceId: claims.workspaceId },
    select: { id: true },
  });
  if (!contact) throw new AppError('UNAUTHENTICATED', 'Invalid or expired widget session');

  return claims;
}

/**
 * The visitor's one continuous chat thread with this workspace.
 *
 * Unlike the agent inbox — where every call is its own conversation — a chat
 * widget visitor gets a single lifelong thread, Intercom-style. Resolving a
 * conversation doesn't end the relationship; their next message reopens the
 * same thread rather than starting a new one. `appendMessage` already
 * reopens a RESOLVED conversation when the sender is a CONTACT, so finding
 * the single existing CHAT conversation (or creating the first one) is all
 * this needs.
 */
async function getOrCreateThread(workspaceId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { workspaceId, contactId, channel: 'CHAT' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: { workspaceId, contactId, channel: 'CHAT' },
    select: { id: true },
  });
  return created.id;
}

export type StartSessionInput = {
  workspaceSlug: string;
  visitorId?: string;
  name?: string;
  email?: string;
  pageUrl?: string;
};

export type StartSessionResult = {
  token: string;
  visitorId: string;
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  messages: Awaited<ReturnType<typeof prisma.message.findMany>>;
};

export async function startWidgetSession(input: StartSessionInput): Promise<StartSessionResult> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: input.workspaceSlug },
    select: { id: true, name: true },
  });
  if (!workspace) throw new AppError('NOT_FOUND', 'Unknown workspace');

  const visitorId = input.visitorId?.trim() || crypto.randomUUID();

  const contact = await prisma.contact.upsert({
    where: { workspaceId_visitorId: { workspaceId: workspace.id, visitorId } },
    update: {
      lastSeenAt: new Date(),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.pageUrl ? { metadata: { pageUrl: input.pageUrl } } : {}),
    },
    create: {
      workspaceId: workspace.id,
      visitorId,
      name: input.name?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      metadata: input.pageUrl ? { pageUrl: input.pageUrl } : {},
    },
    select: { id: true },
  });

  const conversationId = await getOrCreateThread(workspace.id, contact.id);

  // isPrivateNote: false is not a formality — a note left for the team must
  // never reach the person it might be about.
  const messages = await prisma.message.findMany({
    where: { conversationId, isPrivateNote: false },
    orderBy: { seq: 'asc' },
  });

  const token = await issueWidgetToken(
    { workspaceId: workspace.id, contactId: contact.id, visitorId },
    serverEnv().WIDGET_TOKEN_SECRET,
  );

  return {
    token,
    visitorId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    conversationId,
    messages,
  };
}

function textToSafeHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export async function sendVisitorMessage(
  scope: WidgetScope,
  conversationId: string,
  bodyText: string,
  clientMsgId?: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId, contactId: scope.contactId },
    select: { id: true },
  });
  if (!conversation) throw new AppError('NOT_FOUND', 'Conversation not found');

  const text = bodyText.trim();
  if (!text) throw new AppError('BAD_REQUEST', 'Message cannot be empty');
  if (text.length > 8_000) throw new AppError('BAD_REQUEST', 'Message is too long');

  const result = await appendMessage({
    conversationId,
    workspaceId: scope.workspaceId,
    senderType: 'CONTACT',
    senderContactId: scope.contactId,
    bodyHtml: textToSafeHtml(text),
    bodyText: text,
    clientMsgId: clientMsgId ?? null,
  });

  await markRead(conversationId, participantKeys.contact(scope.contactId), result.message.seq);

  return result;
}
