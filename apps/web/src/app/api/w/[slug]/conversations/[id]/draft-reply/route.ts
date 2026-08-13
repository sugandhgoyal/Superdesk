import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { draftReply } from '@/lib/ai/draft-reply';

export const runtime = 'nodejs';

export const POST = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const result = await draftReply(scope, params.id);
    log.info('Draft reply generated', {
      workspaceId: scope.workspaceId,
      conversationId: params.id,
      usedArticles: result.usedArticles.length,
    });
    return result;
  },
});
