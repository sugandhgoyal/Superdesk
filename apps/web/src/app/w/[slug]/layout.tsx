import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace-context';
import { Logo } from '@/components/ui';
import { WorkspaceNavLinks } from '@/components/workspace-nav-links';
import { SignOutButton } from '@/components/sign-out-button';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, user } = await requireWorkspace(slug);

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border px-4">
        <Link href={`/w/${slug}/inbox`}>
          <Logo />
        </Link>
        <span className="text-sm font-medium text-fg-muted">{workspace.name}</span>

        <WorkspaceNavLinks slug={slug} />

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-fg-subtle">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
