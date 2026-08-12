'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Button, Textarea, cx } from '@/components/ui';

export function Composer({
  workspaceSlug,
  conversationId,
  onSent,
}: {
  workspaceSlug: string;
  conversationId: string;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const bodyText = text.trim();
    if (!bodyText || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/w/${workspaceSlug}/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { bodyText, isPrivateNote, clientMsgId: crypto.randomUUID() },
      });
      setText('');
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send');
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  return (
    <div
      className={cx(
        'border-t p-3',
        isPrivateNote ? 'border-warning/40 bg-warning/5' : 'border-border',
      )}
    >
      <div className="mb-2 flex items-center gap-1 rounded-md bg-bg-inset p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setIsPrivateNote(false)}
          className={cx(
            'rounded px-2.5 py-1 font-medium transition-colors',
            !isPrivateNote ? 'bg-surface text-fg shadow-[var(--shadow-sm)]' : 'text-fg-muted',
          )}
        >
          Reply
        </button>
        <button
          type="button"
          onClick={() => setIsPrivateNote(true)}
          className={cx(
            'rounded px-2.5 py-1 font-medium transition-colors',
            isPrivateNote ? 'bg-surface text-warning shadow-[var(--shadow-sm)]' : 'text-fg-muted',
          )}
        >
          Private note
        </button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={
          isPrivateNote
            ? 'Leave a note for your team — the customer will never see this…'
            : 'Type a reply…'
        }
        disabled={submitting}
      />

      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-fg-subtle">⌘/Ctrl + Enter to send</span>
        <Button type="button" size="sm" loading={submitting} onClick={send} disabled={!text.trim()}>
          {isPrivateNote ? 'Add note' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
