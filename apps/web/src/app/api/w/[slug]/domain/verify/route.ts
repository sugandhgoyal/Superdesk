import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { refreshDomainStatus } from '@/lib/domains';

export const runtime = 'nodejs';

export const POST = defineRoute({
  rateLimit: { limit: 10, windowSeconds: 60 },
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return refreshDomainStatus(scope);
  },
});
