import { requireWorkspace } from '@/lib/workspace-context';
import { listMembers } from '@/lib/members';
import { listConversations } from '@/lib/conversations';
import { InboxClient } from '@/components/inbox/InboxClient';
import type { ConversationListResponse, MemberOption } from '@/lib/types/inbox';

export default async function InboxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, user, scope } = await requireWorkspace(slug);

  const [members, initialList] = await Promise.all([
    listMembers(scope),
    listConversations(scope, { status: 'ALL' }),
  ]);

  // Server components hand Prisma's Date objects to the client tree as-is;
  // the inbox components expect the same ISO-string shape the JSON API
  // returns (they're also fed by client-side fetches, which never see a Date
  // instance). Round-tripping through JSON here keeps both paths honest
  // about what they're rendering.
  const serializedList = JSON.parse(JSON.stringify(initialList)) as ConversationListResponse;
  const memberOptions = members as MemberOption[];

  return (
    <InboxClient
      workspaceSlug={workspace.slug}
      currentUserId={user.id}
      members={memberOptions}
      initialList={serializedList}
    />
  );
}
