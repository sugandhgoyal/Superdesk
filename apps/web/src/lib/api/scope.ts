import { prisma } from '@superdesk/db';
import type { Scope } from '@superdesk/db/tenant';
import { AppError } from '@superdesk/shared/errors';

/**
 * Turns a URL slug plus the signed-in user into a tenant scope, proving
 * membership in the process.
 *
 * API routes take the workspace from the path rather than the session so that
 * someone in several workspaces can have two tabs open without them fighting
 * over a "current workspace" server-side.
 */
export async function scopeFromSlug(
  userId: string,
  slug: string | undefined,
): Promise<Scope> {
  if (!slug) throw new AppError('BAD_REQUEST', 'Workspace is required');

  const membership = await prisma.membership.findFirst({
    where: { userId, workspace: { slug } },
    select: { role: true, workspaceId: true },
  });

  // 404 rather than 403 — see the note in packages/db/src/tenant.ts.
  if (!membership) throw new AppError('NOT_FOUND', 'Workspace not found');

  return {
    workspaceId: membership.workspaceId,
    userId,
    role: membership.role,
  };
}
