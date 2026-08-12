import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { summarizeConversation } from '@/lib/ai/summarize';

export const runtime = 'nodejs';

export const POST = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const summary = await summarizeConversation(scope, params.id);
    log.info('Conversation summarized', {
      workspaceId: scope.workspaceId,
      conversationId: params.id,
      degraded: summary.degraded,
    });
    return summary;
  },
});
