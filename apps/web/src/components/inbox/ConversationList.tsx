'use client';

import { cx, Badge } from '@/components/ui';
import { relativeTime, initials, contactLabel } from '@/lib/format';
import type { ConversationListItem } from '@/lib/types/inbox';

const STATUS_TONE: Record<ConversationListItem['status'], 'accent' | 'warning' | 'neutral'> = {
  OPEN: 'accent',
  SNOOZED: 'warning',
  RESOLVED: 'neutral',
};

const CHANNEL_LABEL: Record<ConversationListItem['channel'], string> = {
  CHAT: 'Chat',
  EMAIL: 'Email',
};

export function ConversationList({
  items,
  selectedId,
  onSelect,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  if (loading) {
    return (
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg bg-bg-inset" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-sm font-medium text-fg">No conversations here</p>
        <p className="text-sm text-fg-subtle">Nothing matches these filters.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-border">
        {items.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={cx(
                  'block w-full px-3.5 py-3 text-left transition-colors',
                  active ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      active ? 'bg-accent text-accent-fg' : 'bg-bg-inset text-fg-muted',
                    )}
                    aria-hidden="true"
                  >
                    {initials(contactLabel(c.contact))}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cx(
                          'truncate text-sm',
                          c.unread ? 'font-semibold text-fg' : 'font-medium text-fg',
                        )}
                      >
                        {contactLabel(c.contact)}
                      </p>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>

                    {c.subject && (
                      <p className="truncate text-xs text-fg-muted">{c.subject}</p>
                    )}

                    <p
                      className={cx(
                        'mt-0.5 truncate text-sm',
                        c.unread ? 'text-fg' : 'text-fg-subtle',
                      )}
                    >
                      {c.lastMessage?.isPrivateNote && (
                        <span className="text-warning">Note: </span>
                      )}
                      {c.lastMessage?.preview || 'No messages yet'}
                    </p>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      {c.unread && (
                        <span
                          className="size-1.5 rounded-full bg-accent"
                          aria-label="Unread"
                        />
                      )}
                      <Badge tone={STATUS_TONE[c.status]}>
                        {c.status === 'SNOOZED' ? 'Snoozed' : c.status === 'RESOLVED' ? 'Resolved' : 'Open'}
                      </Badge>
                      <Badge tone="neutral">{CHANNEL_LABEL[c.channel]}</Badge>
                      {c.assignee && (
                        <span className="truncate text-xs text-fg-subtle">
                          {c.assignee.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="p-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-border-strong py-2 text-sm text-fg-muted hover:bg-bg-subtle disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
