import { z } from 'zod';
import { AppError } from '@superdesk/shared/errors';
import { defineRoute } from '@/lib/api/route';
import { LIMITS } from '@/lib/ratelimit';
import { authenticateWidget, sendVisitorMessage } from '@/lib/widget/session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  conversationId: z.string().min(1),
  bodyText: z.string().min(1).max(8_000),
  clientMsgId: z.string().optional(),
});
type Body = z.infer<typeof bodySchema>;

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('UNAUTHENTICATED', 'Missing widget session');
  }
  return token;
}

export const POST = defineRoute<Body>({
  auth: false,
  body: bodySchema,
  rateLimit: { ...LIMITS.widgetMessage, bucket: 'widget-message' },
  handler: async ({ req, body }) => {
    const scope = await authenticateWidget(bearerToken(req));
    const result = await sendVisitorMessage(
      scope,
      body.conversationId,
      body.bodyText,
      body.clientMsgId,
    );
    return { message: result.message, deduped: result.deduped };
  },
});
