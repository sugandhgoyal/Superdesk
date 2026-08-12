import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { markConversationRead } from '@/lib/conversations';

export const runtime = 'nodejs';

const bodySchema = z.object({ lastReadSeq: z.number().int().min(0).optional() });
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await markConversationRead(scope, params.id, body.lastReadSeq);
    return { ok: true };
  },
});
