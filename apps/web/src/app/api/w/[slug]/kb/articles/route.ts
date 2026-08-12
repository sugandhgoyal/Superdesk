import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { createArticle, listArticlesAdmin } from '@/lib/kb';

export const runtime = 'nodejs';

const querySchema = z.object({ status: z.enum(['DRAFT', 'PUBLISHED']).optional() });
type Query = z.infer<typeof querySchema>;

export const GET = defineRoute<undefined, Query>({
  query: querySchema,
  handler: async ({ user, query, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return { articles: await listArticlesAdmin(scope, query) };
  },
});

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  sectionId: z.string().nullable().optional(),
  excerpt: z.string().max(300).optional(),
  markdown: z.string().max(50_000),
});
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return createArticle(scope, body);
  },
});
