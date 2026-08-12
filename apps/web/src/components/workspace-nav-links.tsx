'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const LINKS = [
  { href: 'inbox', label: 'Inbox' },
  { href: 'kb', label: 'Knowledge Base' },
];

export function WorkspaceNavLinks({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const href = `/w/${slug}/${link.href}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={link.href}
            href={href}
            className={cx(
              'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-bg-inset text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
