import { prisma } from '@superdesk/db';
import type { Role } from '@superdesk/db';
import { assertAdmin, type Scope } from '@superdesk/db/tenant';
import { AppError } from '@superdesk/shared/errors';

export async function listMembers(scope: Scope) {
  const members = await prisma.membership.findMany({
    where: { workspaceId: scope.workspaceId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      lastSeenAt: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return members.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
    joinedAt: m.createdAt,
    lastSeenAt: m.lastSeenAt,
  }));
}

/**
 * Guards the "no admins left" state.
 *
 * A workspace whose last admin demotes or removes themselves can never be
 * administered again — nobody could invite, change billing, or connect a
 * domain. Cheaper to prevent than to support.
 */
async function assertNotLastAdmin(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const target = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });

  if (target?.role !== 'ADMIN') return;

  const adminCount = await prisma.membership.count({
    where: { workspaceId, role: 'ADMIN' },
  });

  if (adminCount <= 1) {
    throw new AppError(
      'CONFLICT',
      'This is the only admin. Promote someone else first.',
    );
  }
}

export async function changeRole(
  scope: Scope,
  targetUserId: string,
  role: Role,
): Promise<void> {
  assertAdmin(scope);

  if (role !== 'ADMIN') {
    await assertNotLastAdmin(scope.workspaceId, targetUserId);
  }

  const result = await prisma.membership.updateMany({
    where: { workspaceId: scope.workspaceId, userId: targetUserId },
    data: { role },
  });

  if (result.count === 0) {
    throw new AppError('NOT_FOUND', 'That teammate is not in this workspace');
  }
}

export async function removeMember(
  scope: Scope,
  targetUserId: string,
): Promise<void> {
  assertAdmin(scope);
  await assertNotLastAdmin(scope.workspaceId, targetUserId);

  const result = await prisma.membership.deleteMany({
    where: { workspaceId: scope.workspaceId, userId: targetUserId },
  });

  if (result.count === 0) {
    throw new AppError('NOT_FOUND', 'That teammate is not in this workspace');
  }

  // Conversations they were assigned to fall back to unassigned rather than
  // disappearing — onDelete: SetNull on the relation handles this, but only
  // if the user row goes; removing a membership needs it done explicitly.
  await prisma.conversation.updateMany({
    where: { workspaceId: scope.workspaceId, assigneeId: targetUserId },
    data: { assigneeId: null },
  });

  // Deliberately *not* revoking their sessions. Membership is re-checked on
  // every request, so removal already takes effect immediately for this
  // workspace — while a global session revoke would also sign them out of
  // every other workspace they belong to, which isn't ours to do.
}
