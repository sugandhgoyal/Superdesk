import Link from 'next/link';
import Script from 'next/script';
import { Card, Logo } from '@/components/ui';

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const { ws } = await searchParams;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/signup" className="text-sm font-medium text-accent hover:text-accent-hover">
          Create your own workspace →
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Acme Corp</h1>
        <p className="mt-3 text-fg-muted">
          This is a stand-in for a customer&apos;s website — the chat bubble in the
          corner is the real SuperDesk widget, embedded with one script tag,
          talking to a real workspace&apos;s inbox.
        </p>

        {ws ? (
          <Card className="mt-8 p-5">
            <p className="text-sm text-fg-muted">
              Chatting with workspace <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-fg">{ws}</code>.
              Send a message, then open that workspace&apos;s inbox in another tab —
              it shows up there live, and a reply from an agent shows up here
              the same way.
            </p>
          </Card>
        ) : (
          <Card className="mt-8 border-warning/40 bg-warning/5 p-5">
            <p className="text-sm text-fg">
              No workspace selected. Add <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs">?ws=your-slug</code>{' '}
              to this URL — the slug is the one in your inbox&apos;s address,{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs">/w/&lt;slug&gt;/inbox</code>.
            </p>
          </Card>
        )}

        <div className="mt-10 space-y-3 text-sm text-fg-muted">
          <p>Everything above this line is placeholder marketing copy — the widget doesn&apos;t care what&apos;s on the page.</p>
          <p>What it&apos;s embedded with:</p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg-inset p-3 text-xs text-fg">
{`<script src="${'{your-domain}'}/widget.js" data-workspace="${ws || 'your-slug'}" async></script>`}
          </pre>
        </div>
      </main>

      {ws && <Script src="/widget.js" data-workspace={ws} strategy="afterInteractive" />}
    </div>
  );
}
