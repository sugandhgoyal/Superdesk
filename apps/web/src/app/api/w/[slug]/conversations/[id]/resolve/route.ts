import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { resolveConversation } from '@/lib/conversations';

export const runtime = 'nodejs';

export const POST = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await resolveConversation(scope, params.id, user.name);
    log.info('Conversation resolved', { workspaceId: scope.workspaceId, conversationId: params.id });
    return { ok: true };
  },
});
