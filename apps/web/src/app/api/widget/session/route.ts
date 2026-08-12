import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { LIMITS } from '@/lib/ratelimit';
import { startWidgetSession } from '@/lib/widget/session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  workspaceSlug: z.string().min(1).max(60),
  visitorId: z.string().max(100).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  pageUrl: z.string().trim().max(500).optional(),
});
type Body = z.infer<typeof bodySchema>;

// Every widget page load calls this — not just conversation starts — so the
// ceiling is generous relative to the per-message send limit below.
export const POST = defineRoute<Body>({
  auth: false,
  body: bodySchema,
  rateLimit: { ...LIMITS.widgetBoot, bucket: 'widget-session' },
  handler: async ({ body }) => {
    const result = await startWidgetSession({
      workspaceSlug: body.workspaceSlug,
      visitorId: body.visitorId,
      name: body.name,
      email: body.email || undefined,
      pageUrl: body.pageUrl,
    });
    return {
      token: result.token,
      visitorId: result.visitorId,
      workspaceName: result.workspaceName,
      conversationId: result.conversationId,
      messages: result.messages,
    };
  },
});
