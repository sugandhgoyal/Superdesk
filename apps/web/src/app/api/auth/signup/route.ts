import { prisma } from '@superdesk/db';
import { AppError } from '@superdesk/shared/errors';
import { defineRoute } from '@/lib/api/route';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { signupSchema, type SignupInput } from '@/lib/validation';
import { LIMITS } from '@/lib/ratelimit';
import { createWorkspaceWithOwner } from '@/lib/workspace';

export const runtime = 'nodejs';

/**
 * Signup creates a user *and* their first workspace in one step.
 *
 * There is no such thing as a user without a workspace in this product — an
 * account with nowhere to work is a dead end, and forcing a second onboarding
 * screen to fix it just moves the problem.
 */
export const POST = defineRoute<SignupInput>({
  auth: false,
  body: signupSchema,
  rateLimit: { ...LIMITS.signup, bucket: 'signup' },
  handler: async ({ body, log }) => {
    const existing = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(
        'CONFLICT',
        'An account with that email already exists. Try signing in.',
      );
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
      },
      select: { id: true, email: true, name: true },
    });

    const workspace = await createWorkspaceWithOwner(
      user.id,
      body.workspaceName,
    );

    await createSession(user.id);

    log.info('Workspace created', {
      userId: user.id,
      workspaceId: workspace.id,
      slug: workspace.slug,
    });

    return {
      user,
      workspace,
    };
  },
});
