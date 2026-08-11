import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { listWorkspacesForUser } from '@/lib/workspace';
import { Button, Logo } from '@/components/ui';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const workspaces = await listWorkspacesForUser(user.id);
    redirect(workspaces[0] ? `/w/${workspaces[0].slug}/inbox` : '/onboarding');
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          One inbox for every customer conversation.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-fg-muted">
          Live chat and email land in the same place. Assign, snooze, and
          resolve as a team — with an AI summary waiting on the long threads.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup">
            <Button>Create a workspace</Button>
          </Link>
          <Link href="/demo">
            <Button variant="secondary">See the chat widget</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
