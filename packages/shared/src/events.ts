/**
 * The realtime wire protocol, defined once and imported by all three peers:
 * the gateway, the agent dashboard, and the embedded widget.
 *
 * Design notes:
 *
 * - Sockets carry *notifications*, never authoritative state. Every payload a
 *   client receives is also reachable over REST, so a dropped frame degrades
 *   to "slightly stale" rather than "wrong".
 * - Every message-bearing event carries `seq`, the per-conversation monotonic
 *   counter. A client that receives seq N+2 while holding N knows it missed
 *   one and issues `conversation:sync` to backfill from Postgres.
 * - Ephemeral signals (typing, presence) are intentionally lossy. They live in
 *   Redis with a TTL and are never persisted; a missed typing event costs
 *   nothing and is not worth a delivery guarantee.
 */

export const ClientEvent = {
  /** Join a conversation room and backfill anything missed. */
  SUBSCRIBE: 'conversation:subscribe',
  UNSUBSCRIBE: 'conversation:unsubscribe',
  /** Explicit gap-fill after a reconnect. */
  SYNC: 'conversation:sync',
  SEND_MESSAGE: 'message:send',
  TYPING: 'typing',
  MARK_READ: 'read:mark',
} as const;

export const ServerEvent = {
  READY: 'ready',
  MESSAGE_NEW: 'message:new',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_CREATED: 'conversation:created',
  TYPING: 'typing',
  PRESENCE: 'presence',
  READ_UPDATED: 'read:updated',
  ERROR: 'error',
} as const;

export type ActorKind = 'agent' | 'contact';

export type WireActor = {
  kind: ActorKind;
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type WireMessage = {
  id: string;
  conversationId: string;
  seq: number;
  senderType: 'CONTACT' | 'AGENT' | 'SYSTEM' | 'AI';
  sender: WireActor | null;
  bodyHtml: string;
  bodyText: string;
  isPrivateNote: boolean;
  clientMsgId: string | null;
  createdAt: string;
};

// --- client -> server -------------------------------------------------------

export type SubscribePayload = {
  conversationId: string;
  /** Highest seq the client already has; 0 for a fresh load. */
  lastSeq: number;
};

export type SyncPayload = SubscribePayload;

export type SendMessagePayload = {
  conversationId: string;
  /** UUID minted by the client before its first send attempt. */
  clientMsgId: string;
  bodyText: string;
  bodyHtml?: string;
  isPrivateNote?: boolean;
};

export type TypingPayload = {
  conversationId: string;
  isTyping: boolean;
};

export type MarkReadPayload = {
  conversationId: string;
  seq: number;
};

// --- server -> client -------------------------------------------------------

export type MessageNewPayload = {
  conversationId: string;
  message: WireMessage;
};

export type SyncAck = {
  ok: true;
  conversationId: string;
  messages: WireMessage[];
  /** Server's current head, so the client can tell whether it is caught up. */
  headSeq: number;
};

export type TypingBroadcast = {
  conversationId: string;
  actor: WireActor;
  isTyping: boolean;
};

export type PresenceBroadcast = {
  workspaceId: string;
  /** User ids of agents with at least one live socket. */
  onlineAgentIds: string[];
};

export type ReadUpdatedPayload = {
  conversationId: string;
  participantKey: string;
  lastReadSeq: number;
};

export type SocketAck<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string };

export type ErrorPayload = {
  code: string;
  message: string;
};

// --- room naming ------------------------------------------------------------

/**
 * Rooms are the authorization boundary. A socket is only ever put into rooms
 * its credentials permit: agents get their workspace room plus any conversation
 * in it; a widget visitor gets exactly one conversation room and nothing else.
 */
export const rooms = {
  workspace: (workspaceId: string) => `ws:${workspaceId}`,
  conversation: (conversationId: string) => `conv:${conversationId}`,
};

/** How long a presence key survives without a heartbeat. */
export const PRESENCE_TTL_SECONDS = 45;
export const PRESENCE_HEARTBEAT_MS = 15_000;
/** Typing indicators auto-expire client-side if no stop event arrives. */
export const TYPING_TIMEOUT_MS = 4_000;
