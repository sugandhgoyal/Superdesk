'use client';

import { useEffect, useRef } from 'react';
import { cx, Spinner } from '@/components/ui';
import { contactLabel, fullTimestamp, initials, relativeTime } from '@/lib/format';
import { ConversationMeta } from './ConversationMeta';
import { Composer } from './Composer';
import type { ConversationDetail, MemberOption, MessageItem } from '@/lib/types/inbox';

function senderName(
  message: MessageItem,
  conversation: ConversationDetail,
  membersById: Map<string, MemberOption>,
): string {
  switch (message.senderType) {
    case 'CONTACT':
      return contactLabel(conversation.contact);
    case 'AGENT':
      return membersById.get(message.senderUserId ?? '')?.name ?? 'A teammate';
    case 'AI':
      return 'AI';
    case 'SYSTEM':
      return 'System';
  }
}

function MessageBubble({
  message,
  conversation,
  membersById,
}: {
  message: MessageItem;
  conversation: ConversationDetail;
  membersById: Map<string, MemberOption>;
}) {
  if (message.senderType === 'SYSTEM') {
    return (
      <li className="py-1 text-center text-xs text-fg-subtle">
        {message.bodyText} · {relativeTime(message.createdAt)}
      </li>
    );
  }

  const fromContact = message.senderType === 'CONTACT';
  const name = senderName(message, conversation, membersById);

  return (
    <li className={cx('flex gap-2.5', !fromContact && 'flex-row-reverse')}>
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-inset text-[10px] font-semibold text-fg-muted"
        aria-hidden="true"
      >
        {initials(name)}
      </span>

      <div className={cx('max-w-[75%] min-w-0', !fromContact && 'items-end')}>
        <div className={cx('mb-0.5 flex items-baseline gap-1.5 text-xs', !fromContact && 'flex-row-reverse')}>
          <span className="font-medium text-fg-muted">{name}</span>
          <span className="text-fg-subtle" title={fullTimestamp(message.createdAt)}>
            {relativeTime(message.createdAt)}
          </span>
        </div>

        <div
          className={cx(
            'rounded-xl px-3.5 py-2 text-sm break-words',
            message.isPrivateNote
              ? 'border border-warning/40 bg-warning/10 text-fg'
              : fromContact
                ? 'bg-bg-inset text-fg'
                : 'bg-accent text-accent-fg',
          )}
        >
          {message.isPrivateNote && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-warning">
              Private note
            </p>
          )}
          <div dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
        </div>
      </div>
    </li>
  );
}

export function ConversationThread({
  workspaceSlug,
  conversation,
  members,
  loading,
  onChanged,
}: {
  workspaceSlug: string;
  conversation: ConversationDetail | null;
  members: MemberOption[];
  loading: boolean;
  onChanged: () => void;
}) {
  const membersById = new Map(members.map((m) => [m.userId, m]));
  const scrollRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation?.messages.length]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6 text-fg-subtle" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium text-fg">Select a conversation</p>
        <p className="text-sm text-fg-subtle">Pick one from the list to see the full thread.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ConversationMeta
        workspaceSlug={workspaceSlug}
        conversation={conversation}
        members={members}
        onChanged={onChanged}
      />

      <ul ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {conversation.messages.length === 0 ? (
          <li className="pt-8 text-center text-sm text-fg-subtle">No messages yet.</li>
        ) : (
          conversation.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              conversation={conversation}
              membersById={membersById}
            />
          ))
        )}
      </ul>

      <Composer workspaceSlug={workspaceSlug} conversationId={conversation.id} onSent={onChanged} />
    </div>
  );
}
