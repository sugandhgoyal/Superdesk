'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Badge, Button, Spinner, cx } from '@/components/ui';
import { fullTimestamp } from '@/lib/format';
import type { ConversationSummaryRecord } from '@/lib/types/inbox';

const SENTIMENT_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'accent'> = {
  positive: 'success',
  neutral: 'neutral',
  frustrated: 'warning',
  negative: 'warning',
};

export function SummaryPanel({
  workspaceSlug,
  conversationId,
  summary,
  onChanged,
}: {
  workspaceSlug: string;
  conversationId: string;
  summary: ConversationSummaryRecord | null;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/w/${workspaceSlug}/conversations/${conversationId}/summarize`, {
        method: 'POST',
        body: {},
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to summarize');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-b border-border bg-bg-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">AI summary</h3>
          {summary?.degraded && (
            <Badge tone="warning">Basic — AI unavailable</Badge>
          )}
          {summary && (
            <span className="text-xs text-fg-subtle">Updated {fullTimestamp(summary.updatedAt)}</span>
          )}
        </div>
        <Button type="button" size="sm" variant="secondary" loading={loading} onClick={generate}>
          {summary ? 'Refresh' : 'Generate'}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {loading && !summary && (
        <div className="mt-3 flex items-center gap-2 text-sm text-fg-subtle">
          <Spinner className="size-4" />
          Summarizing…
        </div>
      )}

      {summary && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">What they want</dt>
            <dd className="mt-0.5 text-sm text-fg">{summary.summary.whatUserWants}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">What&apos;s been tried</dt>
            <dd className="mt-0.5 text-sm text-fg">{summary.summary.whatsBeenTried}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Status</dt>
            <dd className="mt-0.5 text-sm text-fg">{summary.summary.currentStatus}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Sentiment</dt>
            <dd className="mt-0.5">
              <Badge tone={SENTIMENT_TONE[summary.summary.sentiment] ?? 'neutral'}>
                {summary.summary.sentiment}
              </Badge>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Suggested next step</dt>
            <dd className={cx('mt-0.5 text-sm text-fg')}>{summary.summary.suggestedNextStep}</dd>
          </div>
        </dl>
      )}

      {!summary && !loading && (
        <p className="mt-2 text-sm text-fg-subtle">No summary yet for this conversation.</p>
      )}
    </div>
  );
}
