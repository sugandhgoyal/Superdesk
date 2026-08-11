import { defineRoute } from '@/lib/api/route';
import { destroyCurrentSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export const POST = defineRoute({
  // Logging out an already-expired session should succeed quietly rather than
  // bounce the user to a login page to log out.
  auth: false,
  handler: async ({ log }) => {
    await destroyCurrentSession();
    log.info('Session revoked');
    return { ok: true };
  },
});
