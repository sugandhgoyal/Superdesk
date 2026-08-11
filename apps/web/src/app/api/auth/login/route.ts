import { prisma } from '@superdesk/db';
import { AppError } from '@superdesk/shared/errors';
import { defineRoute } from '@/lib/api/route';
import { fakeVerify, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { loginSchema, type LoginInput } from '@/lib/validation';
import { LIMITS } from '@/lib/ratelimit';
import { listWorkspacesForUser } from '@/lib/workspace';

export const runtime = 'nodejs';

export const POST = defineRoute<LoginInput>({
  auth: false,
  body: loginSchema,
  rateLimit: { ...LIMITS.login, bucket: 'login' },
  handler: async ({ body, log }) => {
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Same error text and comparable timing whether the email is unknown or
    // the password is wrong — otherwise this endpoint becomes an oracle for
    // which addresses have accounts.
    if (!user) {
      await fakeVerify();
      log.warn('Login failed: unknown email');
      throw new AppError('UNAUTHENTICATED', 'Incorrect email or password');
    }

    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) {
      log.warn('Login failed: bad password', { userId: user.id });
      throw new AppError('UNAUTHENTICATED', 'Incorrect email or password');
    }

    await createSession(user.id);
    const workspaces = await listWorkspacesForUser(user.id);

    log.info('Login succeeded', { userId: user.id });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaces,
    };
  },
});
