import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { sendMessage } from '@/lib/conversations';

export const runtime = 'nodejs';

const bodySchema = z.object({
  bodyText: z.string().min(1).max(20_000),
  isPrivateNote: z.boolean().optional(),
  clientMsgId: z.string().optional(),
});
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  // Agents send several messages a minute in a busy inbox; this is a
  // generous ceiling meant to catch a runaway client, not to throttle normal
  // use.
  rateLimit: { limit: 60, windowSeconds: 60 },
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const result = await sendMessage(scope, params.id, body);
    log.info('Message sent', {
      workspaceId: scope.workspaceId,
      conversationId: params.id,
      isPrivateNote: body.isPrivateNote ?? false,
      deduped: result.deduped,
    });
    return { message: result.message, deduped: result.deduped };
  },
});
