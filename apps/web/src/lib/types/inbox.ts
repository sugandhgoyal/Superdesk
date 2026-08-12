/**
 * Client-side mirrors of the inbox API's JSON shapes.
 *
 * Kept separate from the Prisma-backed types in lib/conversations.ts on
 * purpose — those have `Date` fields, these have the ISO strings dates
 * become once they cross a `NextResponse.json()` boundary.
 */

export type ConversationStatus = 'OPEN' | 'SNOOZED' | 'RESOLVED';
export type Channel = 'CHAT' | 'EMAIL';
export type SenderType = 'CONTACT' | 'AGENT' | 'SYSTEM' | 'AI';

export type ContactRef = {
  id: string;
  name: string | null;
  email: string | null;
};

export type AssigneeRef = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type ConversationListItem = {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  snoozedUntil: string | null;
  lastMessageAt: string;
  contact: ContactRef;
  assignee: AssigneeRef | null;
  lastMessage: {
    preview: string;
    senderType: SenderType;
    isPrivateNote: boolean;
    createdAt: string;
  } | null;
  unread: boolean;
};

export type ConversationListResponse = {
  items: ConversationListItem[];
  nextCursor: string | null;
};

export type MessageItem = {
  id: string;
  seq: number;
  senderType: SenderType;
  senderUserId: string | null;
  senderContactId: string | null;
  bodyHtml: string;
  bodyText: string;
  isPrivateNote: boolean;
  createdAt: string;
};

export type ConversationDetail = {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  snoozedUntil: string | null;
  lastMessageAt: string;
  msgSeq: number;
  createdAt: string;
  contact: ContactRef & { metadata: unknown };
  assignee: (AssigneeRef & { email: string }) | null;
  messages: MessageItem[];
  summary: {
    summary: unknown;
    upToSeq: number;
    degraded: boolean;
    updatedAt: string;
  } | null;
};

export type ConversationDetailResponse = {
  conversation: ConversationDetail;
  readStates: { participantKey: string; lastReadSeq: number }[];
};

export type MemberOption = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: 'ADMIN' | 'AGENT';
};

export type StatusFilter = ConversationStatus | 'ALL';
export type AssigneeFilter = 'everyone' | 'me' | 'unassigned' | (string & {});
