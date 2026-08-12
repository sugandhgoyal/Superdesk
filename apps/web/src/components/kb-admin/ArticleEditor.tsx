'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Alert, Button, Field, Input, Select, Textarea, Badge } from '@/components/ui';
import type { AdminArticleFull, AdminSection } from '@/lib/types/kb';

export function ArticleEditor({
  workspaceSlug,
  sections,
  article,
  onSaved,
  onDeleted,
  onClose,
}: {
  workspaceSlug: string;
  sections: AdminSection[];
  article: AdminArticleFull | null;
  onSaved: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [sectionId, setSectionId] = useState(article?.sectionId ?? '');
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? '');
  const [markdown, setMarkdown] = useState(article?.bodyMarkdown ?? '');
  const [status, setStatus] = useState(article?.status ?? 'DRAFT');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/w/${workspaceSlug}/kb/articles`;

  async function save(nextStatus?: 'DRAFT' | 'PUBLISHED') {
    if (!title.trim() || !markdown.trim()) {
      setError('Title and content are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        title,
        sectionId: sectionId || null,
        excerpt: excerpt || undefined,
        markdown,
        ...(nextStatus ? { status: nextStatus } : {}),
      };
      if (article) {
        await api(`${base}/${article.id}`, { method: 'PATCH', body });
      } else {
        await api(`${base}`, { method: 'POST', body });
      }
      if (nextStatus) setStatus(nextStatus);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!article) return;
    if (!confirm(`Delete "${article.title}"? This can't be undone.`)) return;
    setSubmitting(true);
    try {
      await api(`${base}/${article.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-fg">
            {article ? 'Edit article' : 'New article'}
          </h2>
          {article && (
            <Badge tone={status === 'PUBLISHED' ? 'success' : 'neutral'}>
              {status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
          aria-label="Close editor"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mt-4 space-y-4">
        <Field label="Title" htmlFor="a-title">
          <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>

        <Field label="Section" htmlFor="a-section" hint="Optional">
          <Select id="a-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">No section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Excerpt" htmlFor="a-excerpt" hint="Shown in search results and article lists. Auto-generated if left blank.">
          <Input id="a-excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} maxLength={300} />
        </Field>

        <Field label="Content" htmlFor="a-body" hint="Markdown — headings, **bold**, lists, links, code.">
          <Textarea
            id="a-body"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={16}
            className="font-mono text-[13px]"
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" loading={submitting} onClick={() => save()}>
          Save draft
        </Button>
        <Button type="button" loading={submitting} onClick={() => save('PUBLISHED')}>
          {status === 'PUBLISHED' ? 'Save & keep published' : 'Publish'}
        </Button>
        {status === 'PUBLISHED' && (
          <Button type="button" variant="secondary" loading={submitting} onClick={() => save('DRAFT')}>
            Unpublish
          </Button>
        )}
        {article && (
          <Button type="button" variant="danger" className="ml-auto" loading={submitting} onClick={remove}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
