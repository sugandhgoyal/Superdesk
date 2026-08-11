import { defineRoute } from '@/lib/api/route';
import { createSession } from '@/lib/auth/session';
import { acceptInvite } from '@/lib/invites';
import { acceptInviteSchema, type AcceptInviteInput } from '@/lib/validation';
import { LIMITS } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export const POST = defineRoute<AcceptInviteInput>({
  auth: false,
  body: acceptInviteSchema,
  // Same budget as signup — this endpoint also creates accounts.
  rateLimit: { ...LIMITS.signup, bucket: 'invite-accept' },
  handler: async ({ body, log }) => {
    const { userId, workspaceSlug } = await acceptInvite(body.token, {
      name: body.name,
      password: body.password,
    });

    await createSession(userId);
    log.info('Invite accepted', { userId, workspaceSlug });

    return { workspaceSlug };
  },
});
