import { requireWorkspace } from '@/lib/workspace-context';
import { listArticlesAdmin, listSectionsAdmin } from '@/lib/kb';
import { KbAdminClient } from '@/components/kb-admin/KbAdminClient';
import type { AdminArticleListItem, AdminSection } from '@/lib/types/kb';

export default async function KbAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, scope } = await requireWorkspace(slug);
  const [sections, articles] = await Promise.all([
    listSectionsAdmin(scope),
    listArticlesAdmin(scope),
  ]);

  return (
    <KbAdminClient
      workspaceSlug={workspace.slug}
      initialSections={JSON.parse(JSON.stringify(sections)) as AdminSection[]}
      initialArticles={JSON.parse(JSON.stringify(articles)) as AdminArticleListItem[]}
    />
  );
}
