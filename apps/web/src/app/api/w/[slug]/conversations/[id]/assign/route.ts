import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { assignConversation } from '@/lib/conversations';

export const runtime = 'nodejs';

const bodySchema = z.object({ assigneeId: z.string().nullable() });
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await assignConversation(scope, params.id, body.assigneeId, user.name);
    log.info('Conversation assigned', {
      workspaceId: scope.workspaceId,
      conversationId: params.id,
      assigneeId: body.assigneeId,
    });
    return { ok: true };
  },
});
