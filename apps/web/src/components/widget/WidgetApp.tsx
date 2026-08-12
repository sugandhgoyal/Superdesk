'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { relativeTime } from '@/lib/format';
import type { MessageItem } from '@/lib/types/inbox';

type SessionResponse = {
  token: string;
  visitorId: string;
  workspaceName: string;
  conversationId: string;
  messages: MessageItem[];
};

function visitorIdKey(workspaceSlug: string): string {
  return `sd_visitor_${workspaceSlug}`;
}

function notifyHost(payload: Record<string, unknown>) {
  try {
    window.parent.postMessage({ source: 'superdesk-widget', ...payload }, '*');
  } catch {
    // Not embedded in an iframe (e.g. previewed directly) — nothing to notify.
  }
}

export function WidgetApp({ workspaceSlug }: { workspaceSlug: string }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Boot: resolve (or create) the visitor's identity and their one
  // continuous thread with this workspace, then open the live stream.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const storedVisitorId = localStorage.getItem(visitorIdKey(workspaceSlug)) ?? undefined;
      try {
        const result = await api<SessionResponse>('/api/widget/session', {
          method: 'POST',
          body: { workspaceSlug, visitorId: storedVisitorId, pageUrl: document.referrer },
        });
        if (cancelled) return;

        localStorage.setItem(visitorIdKey(workspaceSlug), result.visitorId);
        setSession(result);
        setMessages(result.messages);

        const lastSeq = result.messages.at(-1)?.seq ?? 0;
        const es = new EventSource(
          `/api/widget/stream?token=${encodeURIComponent(result.token)}&conversationId=${result.conversationId}&afterSeq=${lastSeq}`,
        );
        es.onmessage = (event) => {
          try {
            const message: MessageItem = JSON.parse(event.data);
            setMessages((prev) =>
              prev.some((m) => m.id === message.id)
                ? prev
                : [...prev, message].sort((a, b) => a.seq - b.seq),
            );
            if (message.senderType === 'AGENT' || message.senderType === 'AI') {
              notifyHost({ type: 'message', preview: message.bodyText.slice(0, 120) });
            }
          } catch {
            // Skip a malformed frame; the next one carries its own id.
          }
        };
        eventSourceRef.current = es;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't connect. Try again shortly.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    boot();
    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, [workspaceSlug]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = useCallback(async () => {
    const bodyText = text.trim();
    if (!bodyText || !session || sending) return;

    setSending(true);
    setError(null);
    const clientMsgId = crypto.randomUUID();
    try {
      const result = await api<{ message: MessageItem }>('/api/widget/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: { conversationId: session.conversationId, bodyText, clientMsgId },
      });
      setMessages((prev) =>
        prev.some((m) => m.id === result.message.id) ? prev : [...prev, result.message],
      );
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send. Try again.');
    } finally {
      setSending(false);
    }
  }, [text, session, sending]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-6 text-center">
        <p className="text-sm font-medium text-fg">Chat unavailable</p>
        <p className="text-sm text-fg-subtle">{error ?? 'Please try again shortly.'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-accent px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-accent-fg">{session.workspaceName}</p>
          <p className="text-xs text-accent-fg/80">We typically reply in a few minutes</p>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={() => notifyHost({ type: 'close' })}
          className="rounded-md p-1 text-accent-fg/80 hover:bg-black/10 hover:text-accent-fg"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <ul ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <li className="pt-6 text-center text-sm text-fg-subtle">
            Send a message to start the conversation.
          </li>
        )}
        {messages.map((m) => {
          if (m.senderType === 'SYSTEM') {
            return (
              <li key={m.id} className="text-center text-xs text-fg-subtle">
                {m.bodyText}
              </li>
            );
          }
          const fromVisitor = m.senderType === 'CONTACT';
          return (
            <li key={m.id} className={fromVisitor ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[80%]">
                <div
                  className={
                    fromVisitor
                      ? 'rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-fg'
                      : 'rounded-2xl rounded-bl-sm bg-bg-inset px-3.5 py-2 text-sm text-fg'
                  }
                >
                  <div dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                </div>
                <p
                  className={
                    fromVisitor
                      ? 'mt-0.5 text-right text-[11px] text-fg-subtle'
                      : 'mt-0.5 text-[11px] text-fg-subtle'
                  }
                >
                  {relativeTime(m.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="px-3 pb-1 text-xs text-danger">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 border-t border-border p-2.5"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          disabled={sending}
          className="h-10 flex-1 rounded-full border border-border-strong bg-surface px-4 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" className="size-4.5" fill="currentColor" aria-hidden="true">
            <path d="M2.5 17.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
