import { z } from 'zod';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { changeRole, removeMember } from '@/lib/members';

export const runtime = 'nodejs';

const roleSchema = z.object({ role: z.enum(['ADMIN', 'AGENT']) });
type RoleInput = z.infer<typeof roleSchema>;

export const PATCH = defineRoute<RoleInput>({
  body: roleSchema,
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await changeRole(scope, params.userId, body.role);
    log.info('Role changed', {
      workspaceId: scope.workspaceId,
      targetUserId: params.userId,
      role: body.role,
    });
    return { ok: true };
  },
});

export const DELETE = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await removeMember(scope, params.userId);
    log.info('Member removed', {
      workspaceId: scope.workspaceId,
      targetUserId: params.userId,
    });
    return { ok: true };
  },
});
