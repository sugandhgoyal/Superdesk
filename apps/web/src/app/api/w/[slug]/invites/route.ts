import { features } from '@superdesk/shared/env';
import { defineRoute } from '@/lib/api/route';
import { scopeFromSlug } from '@/lib/api/scope';
import { createInvite, listPendingInvites } from '@/lib/invites';
import { inviteSchema, type InviteInput } from '@/lib/validation';
import { LIMITS } from '@/lib/ratelimit';
import { sendInviteEmail } from '@/lib/email/send-invite';

export const runtime = 'nodejs';

export const GET = defineRoute({
  handler: async ({ user, params }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    return { invites: await listPendingInvites(scope) };
  },
});

export const POST = defineRoute<InviteInput>({
  body: inviteSchema,
  rateLimit: { ...LIMITS.inviteSend, bucket: 'invite' },
  handler: async ({ user, body, params, log }) => {
    const scope = await scopeFromSlug(user.id, params.slug);
    const invite = await createInvite(scope, body.email, body.role);

    // Email delivery is best-effort. If the provider is unconfigured or down,
    // the invite still exists and the admin can copy the link by hand — the
    // feature degrades instead of failing.
    let emailed = false;
    if (features().outboundEmail) {
      emailed = await sendInviteEmail({
        to: invite.email,
        inviterName: user.name,
        url: invite.url,
      }).catch((err) => {
        log.error('Invite email failed to send', err, { email: invite.email });
        return false;
      });
    }

    log.info('Invite created', {
      workspaceId: scope.workspaceId,
      role: invite.role,
      emailed,
    });

    // The raw link is returned exactly once, here.
    return { invite, emailed };
  },
});
