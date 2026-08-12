import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { getConversation } from '@/lib/conversations';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return getConversation(scope, params.id);
  },
});
