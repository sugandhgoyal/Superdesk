import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { revokeInvite } from '@/lib/invites';

export const runtime = 'nodejs';

export const DELETE = defineRoute({
  handler: async ({ user, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    await revokeInvite(scope, params.inviteId);
    log.info('Invite revoked', { workspaceId: scope.workspaceId });
    return { ok: true };
  },
});
