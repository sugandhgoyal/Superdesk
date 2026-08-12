import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { AppError } from '@superdesk/shared/errors';
import { scopeFromSlug } from '@/lib/api/scope';
import { snoozeConversation } from '@/lib/conversations';

export const runtime = 'nodejs';

const bodySchema = z.object({ until: z.string() });
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const until = new Date(body.until);
    if (Number.isNaN(until.getTime())) {
      throw new AppError('BAD_REQUEST', 'Invalid date');
    }
    await snoozeConversation(scope, params.id, until, user.name);
    log.info('Conversation snoozed', {
      workspaceId: scope.workspaceId,
      conversationId: params.id,
      until: until.toISOString(),
    });
    return { ok: true };
  },
});
