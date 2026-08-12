import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { emailSchema } from '@/lib/validation';
import { scopeFromSlug } from '@/lib/api/scope';
import { listConversations, startConversation } from '@/lib/conversations';

export const runtime = 'nodejs';

const querySchema = z.object({
  status: z.enum(['OPEN', 'SNOOZED', 'RESOLVED', 'ALL']).optional(),
  assignee: z.string().optional(),
  channel: z.enum(['CHAT', 'EMAIL']).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
type Query = z.infer<typeof querySchema>;

export const GET = defineRoute<undefined, Query>({
  query: querySchema,
  handler: async ({ user, query, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return listConversations(scope, query);
  },
});

const startSchema = z.object({
  contactEmail: emailSchema,
  contactName: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(200).optional(),
  bodyText: z.string().min(1).max(20_000),
});
type StartBody = z.infer<typeof startSchema>;

export const POST = defineRoute<StartBody>({
  body: startSchema,
  rateLimit: { limit: 30, windowSeconds: 60 },
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const conversationId = await startConversation(scope, body);
    log.info('Conversation started', { workspaceId: scope.workspaceId, conversationId });
    return { id: conversationId };
  },
});
