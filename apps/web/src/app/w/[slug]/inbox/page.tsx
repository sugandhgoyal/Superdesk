import { serverEnv } from '@superdesk/shared/env';
import { requireWorkspace } from '@/lib/workspace-context';
import { supportAddress } from '@/lib/workspace';
import { Badge, Card } from '@/components/ui';

export default async function InboxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, user, scope } = await requireWorkspace(slug);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <Badge tone="accent">{scope.role}</Badge>
      </div>

      <Card className="p-5">
        <p className="text-sm text-fg-muted">
          Signed in as <span className="text-fg">{user.email}</span> in{' '}
          <span className="text-fg">{workspace.name}</span>.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Support address:{' '}
          <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-fg">
            {supportAddress(
              workspace.inboundAlias,
              serverEnv().INBOUND_EMAIL_DOMAIN,
            )}
          </code>
        </p>
      </Card>
    </div>
  );
}
