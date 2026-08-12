'use client';

import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Badge, Button, Input } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { ArticleEditor } from './ArticleEditor';
import type { AdminArticleFull, AdminSection } from '@/lib/types/kb';

export function KbAdminClient({
  workspaceSlug,
  initialSections,
}: {
  workspaceSlug: string;
  initialSections: AdminSection[];
}) {
  const [sections, setSections] = useState(initialSections);
  const [selected, setSelected] = useState<AdminArticleFull | 'new' | null>(null);
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSections = useCallback(async () => {
    try {
      const res = await api<{ sections: AdminSection[] }>(`/api/w/${workspaceSlug}/kb/sections`);
      setSections(res.sections);
    } catch {
      // Leave the previous list showing — a failed background refresh isn't
      // worth surfacing over whatever action just succeeded.
    }
  }, [workspaceSlug]);

  async function openArticle(id: string) {
    try {
      const article = await api<AdminArticleFull>(`/api/w/${workspaceSlug}/kb/articles/${id}`);
      setSelected(article);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load article');
    }
  }

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    const name = newSectionName.trim();
    if (!name) return;
    setAddingSection(true);
    try {
      await api(`/api/w/${workspaceSlug}/kb/sections`, { method: 'POST', body: { name } });
      setNewSectionName('');
      await refreshSections();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create section');
    } finally {
      setAddingSection(false);
    }
  }

  async function deleteSection(id: string, name: string) {
    if (!confirm(`Delete section "${name}"? Its articles will become uncategorized, not deleted.`)) return;
    try {
      await api(`/api/w/${workspaceSlug}/kb/sections/${id}`, { method: 'DELETE' });
      await refreshSections();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete section');
    }
  }

  const allSections = sections; // includes uncategorized handling below via null section

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-border p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-fg">Knowledge Base</h1>
          <Button type="button" size="sm" onClick={() => setSelected('new')}>
            New article
          </Button>
        </div>

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}

        <p className="mb-1 text-xs font-medium text-fg-subtle">
          Public site:{' '}
          <a
            href={`/help/${workspaceSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            /help/{workspaceSlug} ↗
          </a>
        </p>

        <div className="mt-4 space-y-4">
          {allSections.map((section) => (
            <div key={section.id}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-fg">{section.name}</h2>
                <button
                  type="button"
                  onClick={() => deleteSection(section.id, section.name)}
                  className="text-xs text-fg-subtle hover:text-danger"
                >
                  Delete section
                </button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {section.articles.length === 0 && (
                  <li className="py-1 text-xs text-fg-subtle">No articles yet</li>
                )}
                {section.articles.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => openArticle(a.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-subtle"
                    >
                      <span className="truncate text-fg">{a.title}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={a.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                          {a.status === 'PUBLISHED' ? 'Live' : 'Draft'}
                        </Badge>
                        <span className="text-xs text-fg-subtle">{relativeTime(a.updatedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <form onSubmit={addSection} className="flex gap-2 pt-2">
            <Input
              placeholder="New section name…"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              className="h-9"
            />
            <Button type="submit" variant="secondary" size="sm" loading={addingSection}>
              Add
            </Button>
          </form>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <ArticleEditor
            workspaceSlug={workspaceSlug}
            sections={sections}
            article={selected === 'new' ? null : selected}
            onSaved={async () => {
              await refreshSections();
              if (selected !== 'new') await openArticle(selected.id);
            }}
            onDeleted={() => {
              setSelected(null);
              refreshSections();
            }}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-fg">Select an article, or write a new one</p>
            <p className="text-sm text-fg-subtle">Articles are Markdown — headings, lists, links, code blocks.</p>
          </div>
        )}
      </div>
    </div>
  );
}
