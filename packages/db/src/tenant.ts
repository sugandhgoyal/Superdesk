import { Prisma, prisma } from './index';
import type { Channel, ConversationStatus, SenderType } from '../generated/client';

/**
 * Tenant isolation.
 *
 * Every read and write in the product is scoped to one workspace. Rather than
 * trusting each route handler to remember a `where: { workspaceId }` clause,
 * feature code goes through helpers that take the scope as a required first
 * argument — forgetting it is a type error, not a data leak.
 *
 * Postgres RLS was considered as a second layer and deliberately deferred: it
 * needs a per-transaction `SET LOCAL` to carry the tenant id, which fights
 * with Neon's transaction pooler. Documented as a known limitation rather than
 * half-implemented.
 */
export type Scope = {
  workspaceId: string;
  userId: string;
  role: 'ADMIN' | 'AGENT';
};

/**
 * Caller is reaching outside their tenant. Surfaces as 404 — a 403 would
 * confirm the resource exists.
 */
export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantError';
  }
}

/**
 * Caller is inside the right tenant but lacks the role for this action.
 *
 * Distinct from TenantError on purpose: they already know the workspace
 * exists — they're a member — so hiding it behind a 404 would only confuse
 * them without concealing anything. This one surfaces as a 403 with a
 * message they can act on.
 */
export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

/**
 * Confirms the caller belongs to the workspace and returns their scope.
 * Called once per authenticated request; the result is threaded through.
 */
export async function resolveScope(
  userId: string,
  workspaceId: string,
): Promise<Scope> {
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });

  if (!membership) {
    // Deliberately indistinguishable from "workspace does not exist" so the
    // endpoint can't be used to enumerate workspace ids.
    throw new TenantError('Workspace not found');
  }

  return { workspaceId, userId, role: membership.role };
}

export function assertAdmin(scope: Scope): void {
  if (scope.role !== 'ADMIN') {
    throw new RoleError('Only admins can do that');
  }
}

/** Narrows any `where` clause to the caller's workspace. */
export function scoped<T extends object>(scope: Scope, where?: T) {
  return { ...(where ?? ({} as T)), workspaceId: scope.workspaceId };
}

// ---------------------------------------------------------------------------
// Message append — the one write path with real ordering requirements
// ---------------------------------------------------------------------------

export type AppendMessageInput = {
  conversationId: string;
  workspaceId: string;
  senderType: SenderType;
  senderUserId?: string | null;
  senderContactId?: string | null;
  bodyHtml: string;
  bodyText: string;
  clientMsgId?: string | null;
  isPrivateNote?: boolean;
  emailMessageId?: string | null;
  emailInReplyTo?: string | null;
  emailReferences?: string | null;
  attachments?: Prisma.InputJsonValue;
};

export type AppendMessageResult = {
  message: Awaited<ReturnType<typeof prisma.message.create>>;
  /** True when this was a retry of a message we already stored. */
  deduped: boolean;
  conversationStatus: ConversationStatus;
  reopened: boolean;
};

/**
 * Appends a message and allocates its per-conversation sequence number.
 *
 * Ordering guarantee: `seq` comes from an atomic increment of
 * `conversation.msgSeq` inside the transaction. That UPDATE takes a row-level
 * lock, so concurrent appends to the same conversation serialize and every
 * client sees the same total order. Clients detect gaps by comparing the
 * incoming seq to their last known one and re-syncing from the API if the
 * socket dropped a frame.
 *
 * Idempotency: senders attach a `clientMsgId` (a UUID they generate before the
 * first attempt). A retry after a socket drop returns the original row instead
 * of creating a duplicate.
 */
export async function appendMessage(
  input: AppendMessageInput,
): Promise<AppendMessageResult> {
  const {
    conversationId,
    workspaceId,
    senderType,
    clientMsgId,
    isPrivateNote = false,
  } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      if (clientMsgId) {
        const existing = await tx.message.findUnique({
          where: {
            conversationId_clientMsgId: { conversationId, clientMsgId },
          },
        });
        if (existing) {
          const conv = await tx.conversation.findUniqueOrThrow({
            where: { id: conversationId },
            select: { status: true },
          });
          return {
            message: existing,
            deduped: true,
            conversationStatus: conv.status,
            reopened: false,
          };
        }
      }

      const before = await tx.conversation.findFirstOrThrow({
        // workspaceId in the filter, not just the id — a leaked conversation id
        // from another tenant must not be writable.
        where: { id: conversationId, workspaceId },
        select: { status: true, firstResponseAt: true },
      });

      // A contact replying to a resolved thread reopens it. An agent replying
      // does not — they may be sending a closing note.
      const reopened =
        before.status === 'RESOLVED' && senderType === 'CONTACT';

      const isFirstAgentReply =
        senderType === 'AGENT' && !isPrivateNote && !before.firstResponseAt;

      const conversation = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          msgSeq: { increment: 1 },
          lastMessageAt: new Date(),
          ...(reopened ? { status: 'OPEN', resolvedAt: null } : {}),
          ...(isFirstAgentReply ? { firstResponseAt: new Date() } : {}),
          // Any new activity cancels a snooze.
          ...(before.status === 'SNOOZED'
            ? { status: 'OPEN', snoozedUntil: null }
            : {}),
        },
        select: { msgSeq: true, status: true },
      });

      const message = await tx.message.create({
        data: {
          conversationId,
          workspaceId,
          seq: conversation.msgSeq,
          senderType,
          senderUserId: input.senderUserId ?? null,
          senderContactId: input.senderContactId ?? null,
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText,
          clientMsgId: clientMsgId ?? null,
          isPrivateNote,
          emailMessageId: input.emailMessageId ?? null,
          emailInReplyTo: input.emailInReplyTo ?? null,
          emailReferences: input.emailReferences ?? null,
          attachments: input.attachments ?? [],
        },
      });

      return {
        message,
        deduped: false,
        conversationStatus: conversation.status,
        reopened,
      };
    });
  } catch (err) {
    // Two concurrent retries of the same clientMsgId can both miss the
    // findUnique above and race to insert. The unique constraint decides the
    // winner; the loser reads the winner's row.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      clientMsgId
    ) {
      const existing = await prisma.message.findUniqueOrThrow({
        where: { conversationId_clientMsgId: { conversationId, clientMsgId } },
      });
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { status: true },
      });
      return {
        message: existing,
        deduped: true,
        conversationStatus: conv.status,
        reopened: false,
      };
    }
    throw err;
  }
}

/**
 * Replays messages a client missed while disconnected.
 *
 * The socket is a fast path, never the source of truth — on reconnect the
 * client says "I have up to seq N" and we hand back everything after it from
 * Postgres. This is what makes at-least-once socket delivery safe.
 */
export async function messagesSince(
  conversationId: string,
  workspaceId: string,
  afterSeq: number,
  limit = 200,
) {
  return prisma.message.findMany({
    where: {
      conversationId,
      workspaceId,
      seq: { gt: afterSeq },
    },
    orderBy: { seq: 'asc' },
    take: limit,
  });
}

/**
 * Advances a read cursor.
 *
 * Raw upsert with GREATEST because read acks arrive out of order — a client
 * that acks seq 12 then seq 9 (older frame, slower path) must not rewind the
 * cursor. Prisma's upsert can't express "only if larger" in one round trip.
 */
export async function markRead(
  conversationId: string,
  participantKey: string,
  lastReadSeq: number,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ReadState" ("id", "conversationId", "participantKey", "lastReadSeq", "updatedAt")
    VALUES (gen_random_uuid()::text, ${conversationId}, ${participantKey}, ${lastReadSeq}, now())
    ON CONFLICT ("conversationId", "participantKey")
    DO UPDATE SET
      "lastReadSeq" = GREATEST("ReadState"."lastReadSeq", EXCLUDED."lastReadSeq"),
      "updatedAt" = now()
  `;
}

export const participantKeys = {
  user: (id: string) => `user:${id}`,
  contact: (id: string) => `contact:${id}`,
};

export type { Channel, ConversationStatus, SenderType };
