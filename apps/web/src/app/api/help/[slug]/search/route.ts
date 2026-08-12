import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { LIMITS } from '@/lib/ratelimit';
import { searchPublicArticles } from '@/lib/kb';

export const runtime = 'nodejs';

const querySchema = z.object({ q: z.string().max(200).default('') });
type Query = z.infer<typeof querySchema>;

export const GET = defineRoute<undefined, Query>({
  auth: false,
  query: querySchema,
  rateLimit: { ...LIMITS.kbSearch, bucket: 'kb-search' },
  handler: async ({ query, params }) => {
    const results = await searchPublicArticles(params.slug, query.q);
    return { results };
  },
});
