'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Input } from '@/components/ui';

type SearchResult = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  sectionSlug: string | null;
};

export function KbSearchBox({ workspaceSlug }: { workspaceSlug: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api<{ results: SearchResult[] }>(
          `/api/help/${workspaceSlug}/search?q=${encodeURIComponent(query)}`,
        );
        setResults(res.results);
        setOpen(true);
      } catch {
        // A failed search just leaves the dropdown empty — not worth an error UI.
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, workspaceSlug]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <Input
        placeholder="Search for answers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => q.trim() && setOpen(true)}
        aria-label="Search the knowledge base"
        className="h-12 text-base"
      />

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-[var(--shadow-md)]">
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/help/${workspaceSlug}/${r.slug}`}
              className="block rounded-md px-3 py-2 hover:bg-bg-subtle"
              onClick={() => setOpen(false)}
            >
              <p className="text-sm font-medium text-fg">{r.title}</p>
              {r.excerpt && <p className="truncate text-xs text-fg-subtle">{r.excerpt}</p>}
            </Link>
          ))}
        </div>
      )}

      {open && q.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1.5 rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow-md)]">
          <p className="text-sm text-fg-subtle">No articles match &ldquo;{q.trim()}&rdquo;.</p>
        </div>
      )}
    </div>
  );
}
