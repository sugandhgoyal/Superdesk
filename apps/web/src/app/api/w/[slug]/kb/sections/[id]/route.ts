import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { deleteSection, updateSection } from '@/lib/kb';

export const runtime = 'nodejs';

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  position: z.number().int().min(0).optional(),
});
type Body = z.infer<typeof bodySchema>;

export const PATCH = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return updateSection(scope, params.id, body);
  },
});

export const DELETE = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await deleteSection(scope, params.id);
    return { ok: true };
  },
});
