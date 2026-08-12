import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { createSection, listSectionsAdmin } from '@/lib/kb';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return { sections: await listSectionsAdmin(scope) };
  },
});

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
type Body = z.infer<typeof bodySchema>;

export const POST = defineRoute<Body>({
  body: bodySchema,
  handler: async ({ user, body, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return createSection(scope, body);
  },
});
