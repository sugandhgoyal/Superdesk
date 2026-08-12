import { requireWorkspace } from '@/lib/workspace-context';
import { getDomainInfo } from '@/lib/domains';
import { features } from '@superdesk/shared/env';
import { DomainSettingsClient } from '@/components/domain/DomainSettingsClient';
import type { DomainInfo } from '@/lib/domains';

export default async function DomainSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, scope } = await requireWorkspace(slug);
  const info = await getDomainInfo(scope);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Custom domain</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Serve your help center at your own domain instead of{' '}
        <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-xs">/help/{workspace.slug}</code>. SSL is
        issued automatically once it&apos;s verified.
      </p>

      <div className="mt-6">
        <DomainSettingsClient
          workspaceSlug={workspace.slug}
          isAdmin={scope.role === 'ADMIN'}
          configured={features().customDomains}
          initialInfo={JSON.parse(JSON.stringify(info)) as DomainInfo}
        />
      </div>
    </div>
  );
}
