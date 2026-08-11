import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { listMembers } from '@/lib/members';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return { members: await listMembers(scope), yourRole: scope.role };
  },
});
