'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Button, Select, cx } from '@/components/ui';
import { fullTimestamp } from '@/lib/format';
import type { ConversationDetail, MemberOption } from '@/lib/types/inbox';

type SnoozePreset = { label: string; compute: () => Date };

const SNOOZE_PRESETS: SnoozePreset[] = [
  { label: 'In 1 hour', compute: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: 'In 3 hours', compute: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: 'Tomorrow, 9am',
    compute: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Next week',
    compute: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

export function ConversationMeta({
  workspaceSlug,
  conversation,
  members,
  onChanged,
  summaryOpen,
  onToggleSummary,
}: {
  workspaceSlug: string;
  conversation: ConversationDetail;
  members: MemberOption[];
  onChanged: () => void;
  summaryOpen: boolean;
  onToggleSummary: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customUntil, setCustomUntil] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
      setSnoozeOpen(false);
    }
  }

  const base = `/api/w/${workspaceSlug}/conversations/${conversation.id}`;

  function assign(assigneeId: string | null) {
    return run(() => api(`${base}/assign`, { method: 'POST', body: { assigneeId } }));
  }

  function resolve() {
    return run(() => api(`${base}/resolve`, { method: 'POST', body: {} }));
  }

  function reopen() {
    return run(() => api(`${base}/reopen`, { method: 'POST', body: {} }));
  }

  function snooze(until: Date) {
    return run(() => api(`${base}/snooze`, { method: 'POST', body: { until: until.toISOString() } }));
  }

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={conversation.assignee?.id ?? ''}
          disabled={busy}
          onChange={(e) => assign(e.target.value || null)}
          aria-label="Assignee"
          className="h-9"
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>

        <div className="relative">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setSnoozeOpen((v) => !v)}
          >
            {conversation.status === 'SNOOZED' && conversation.snoozedUntil
              ? `Snoozed · ${fullTimestamp(conversation.snoozedUntil)}`
              : 'Snooze'}
          </Button>

          {snoozeOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-[var(--shadow-md)]">
              {SNOOZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg-subtle"
                  onClick={() => snooze(preset.compute())}
                >
                  {preset.label}
                </button>
              ))}
              <div className="mt-1 border-t border-border pt-1.5">
                <input
                  type="datetime-local"
                  value={customUntil}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-fg"
                />
                <button
                  type="button"
                  disabled={!customUntil}
                  className={cx(
                    'mt-1 block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg-subtle',
                    customUntil ? 'text-fg' : 'text-fg-subtle',
                  )}
                  onClick={() => customUntil && snooze(new Date(customUntil))}
                >
                  Snooze until custom time
                </button>
              </div>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant={summaryOpen ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleSummary}
        >
          AI summary
        </Button>

        <div className="ml-auto">
          {conversation.status === 'RESOLVED' ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={reopen}>
              Reopen
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={resolve}>
              Resolve
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
