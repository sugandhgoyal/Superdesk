import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { getDomainInfo, removeCustomDomain, requestCustomDomain } from '@/lib/domains';
import { LIMITS } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return getDomainInfo(scope);
  },
});

const bodySchema = z.object({ domain: z.string().min(3).max(253) });
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  rateLimit: { limit: 10, windowSeconds: 3600, bucket: 'domain-add' },
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const result = await requestCustomDomain(scope, body.domain);
    log.info('Custom domain requested', { workspaceId: scope.workspaceId, domain: body.domain });
    return result;
  },
});

export const DELETE = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await removeCustomDomain(scope);
    log.info('Custom domain removed', { workspaceId: scope.workspaceId });
    return { ok: true };
  },
});
