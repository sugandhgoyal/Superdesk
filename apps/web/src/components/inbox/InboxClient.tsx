'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Button, Input, Select, cx } from '@/components/ui';
import { ConversationList } from './ConversationList';
import { ConversationThread } from './ConversationThread';
import { NewConversationModal } from './NewConversationModal';
import type {
  AssigneeFilter,
  ConversationDetailResponse,
  ConversationListResponse,
  MemberOption,
  MessageItem,
  StatusFilter,
} from '@/lib/types/inbox';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SNOOZED', label: 'Snoozed' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All' },
];

// The conversation list isn't message-granular — snoozing or an assignment
// change elsewhere doesn't have a per-message event to hook, so it stays on
// a plain interval. The open thread itself no longer polls at all; see
// connectStream below.
const LIST_POLL_MS = 20_000;

export function InboxClient({
  workspaceSlug,
  currentUserId,
  members,
  initialList,
}: {
  workspaceSlug: string;
  currentUserId: string;
  members: MemberOption[];
  initialList: ConversationListResponse;
}) {
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [assignee, setAssignee] = useState<AssigneeFilter>('everyone');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [list, setList] = useState(initialList);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      params.set('status', status);
      if (assignee !== 'everyone') params.set('assignee', assignee);
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [status, assignee, debouncedSearch],
  );

  const loadList = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setListLoading(true);
      setListError(null);
      try {
        const result = await api<ConversationListResponse>(
          `/api/w/${workspaceSlug}/conversations?${query()}`,
        );
        setList(result);
      } catch (err) {
        setListError(err instanceof ApiError ? err.message : 'Failed to load conversations');
      } finally {
        setListLoading(false);
      }
    },
    [workspaceSlug, query],
  );

  // Refetch whenever filters change.
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, assignee, debouncedSearch]);

  // Background refresh so the list reflects new activity without a manual
  // reload. There's no realtime gateway wired into the inbox yet — this is
  // the interim mechanism, not a placeholder for one that already exists.
  useEffect(() => {
    const id = setInterval(() => loadList({ silent: true }), LIST_POLL_MS);
    return () => clearInterval(id);
  }, [loadList]);

  const loadMore = useCallback(async () => {
    if (!list.nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await api<ConversationListResponse>(
        `/api/w/${workspaceSlug}/conversations?${query(list.nextCursor)}`,
      );
      setList((prev) => ({ items: [...prev.items, ...result.items], nextCursor: result.nextCursor }));
    } catch {
      // Best-effort — the "Load more" button just stays clickable to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [workspaceSlug, query, list.nextCursor]);

  const markRead = useCallback(
    (id: string) => {
      api(`/api/w/${workspaceSlug}/conversations/${id}/read`, { method: 'POST', body: {} }).catch(
        () => {},
      );
      setList((prev) => ({
        ...prev,
        items: prev.items.map((c) => (c.id === id ? { ...c, unread: false } : c)),
      }));
    },
    [workspaceSlug],
  );

  // Holds the live EventSource for whichever conversation is open. A ref, not
  // state — reconnecting is driven explicitly by connectStream, never by a
  // render, so switching the selected conversation can't leave two streams
  // running against the same detail state.
  const eventSourceRef = useRef<EventSource | null>(null);

  const connectStream = useCallback(
    (id: string, afterSeq: number) => {
      eventSourceRef.current?.close();

      const es = new EventSource(
        `/api/w/${workspaceSlug}/conversations/${id}/stream?afterSeq=${afterSeq}`,
      );
      es.onmessage = (event) => {
        let message: MessageItem;
        try {
          message = JSON.parse(event.data);
        } catch {
          return; // Malformed frame — the next one picks up from its own id.
        }

        setDetail((prev) => {
          if (!prev || prev.conversation.id !== id) return prev;
          if (prev.conversation.messages.some((m) => m.id === message.id)) return prev;
          return {
            ...prev,
            conversation: {
              ...prev.conversation,
              messages: [...prev.conversation.messages, message].sort((a, b) => a.seq - b.seq),
              msgSeq: Math.max(prev.conversation.msgSeq, message.seq),
              lastMessageAt: message.createdAt,
            },
          };
        });

        loadList({ silent: true });
        markRead(id);
      };
      eventSourceRef.current = es;
    },
    [workspaceSlug, loadList, markRead],
  );

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  const loadDetail = useCallback(
    async (id: string, opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setDetailLoading(true);
      try {
        const result = await api<ConversationDetailResponse>(
          `/api/w/${workspaceSlug}/conversations/${id}`,
        );
        setDetail(result);
        markRead(id);
        // A silent refresh (after assign/snooze/resolve, say) updates state
        // in place — the stream connection it already has stays open. Only a
        // fresh selection opens a new one, seeded from what this load just
        // returned so nothing already visible gets redelivered.
        if (!opts.silent) connectStream(id, result.conversation.msgSeq);
      } catch {
        if (!opts.silent) setDetail(null);
      } finally {
        if (!opts.silent) setDetailLoading(false);
      }
    },
    [workspaceSlug, markRead, connectStream],
  );

  function selectConversation(id: string) {
    setSelectedId(id);
    loadDetail(id);
  }

  function refreshAfterAction() {
    if (selectedId) loadDetail(selectedId, { silent: true });
    loadList({ silent: true });
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h1 className="text-base font-semibold text-fg">Inbox</h1>
          <Button type="button" size="sm" onClick={() => setShowNewModal(true)}>
            New
          </Button>
        </div>

        <div className="space-y-2 border-b border-border p-3">
          <Input
            placeholder="Search name, email, subject…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search conversations"
          />

          <div className="flex gap-2">
            <div className="flex flex-1 rounded-lg bg-bg-inset p-0.5 text-xs">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setStatus(tab.value)}
                  className={cx(
                    'flex-1 rounded-md px-2 py-1.5 font-medium transition-colors',
                    status === tab.value
                      ? 'bg-surface text-fg shadow-[var(--shadow-sm)]'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <Select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value as AssigneeFilter)}
            aria-label="Filter by assignee"
            className="w-full"
          >
            <option value="everyone">Everyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {members
              .filter((m) => m.userId !== currentUserId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
        </div>

        {listError && <p className="px-3 py-2 text-sm text-danger">{listError}</p>}

        <ConversationList
          items={list.items}
          selectedId={selectedId}
          onSelect={selectConversation}
          loading={listLoading}
          hasMore={Boolean(list.nextCursor)}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
        />
      </div>

      <ConversationThread
        workspaceSlug={workspaceSlug}
        conversation={detail?.conversation ?? null}
        members={members}
        loading={detailLoading}
        onChanged={refreshAfterAction}
      />

      {showNewModal && (
        <NewConversationModal
          workspaceSlug={workspaceSlug}
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => {
            setShowNewModal(false);
            loadList();
            selectConversation(id);
          }}
        />
      )}
    </div>
  );
}
