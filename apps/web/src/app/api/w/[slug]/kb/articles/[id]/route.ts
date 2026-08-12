import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { deleteArticle, getArticleAdmin, setArticleStatus, updateArticle } from '@/lib/kb';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return getArticleAdmin(scope, params.id);
  },
});

const bodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  sectionId: z.string().nullable().optional(),
  excerpt: z.string().max(300).optional(),
  markdown: z.string().max(50_000).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});
type Body = z.infer<typeof bodySchema>;

export const PATCH = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const { status, ...contentInput } = body;

    let article = Object.keys(contentInput).length
      ? await updateArticle(scope, params.id, contentInput)
      : undefined;

    if (status) {
      article = await setArticleStatus(scope, params.id, status);
    }

    return article ?? getArticleAdmin(scope, params.id);
  },
});

export const DELETE = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await deleteArticle(scope, params.id);
    return { ok: true };
  },
});
