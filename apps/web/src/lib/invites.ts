import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@superdesk/db';
import type { Role } from '@superdesk/db';
import { assertAdmin, type Scope } from '@superdesk/db/tenant';
import { AppError } from '@superdesk/shared/errors';
import { serverEnv } from '@superdesk/shared/env';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

/**
 * Team invitations.
 *
 * The raw token exists in exactly one place — the link handed to the inviter.
 * Only its SHA-256 lands in the database, so a leaked dump yields no usable
 * invites. Lookups are by hash, which stays an indexed exact match.
 */

const INVITE_TTL_DAYS = 7;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function inviteUrl(rawToken: string): string {
  return `${serverEnv().APP_URL}/invite/${rawToken}`;
}

export type CreatedInvite = {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  /** Returned once, at creation. Never retrievable again. */
  url: string;
};

export async function createInvite(
  scope: Scope,
  email: string,
  role: Role,
): Promise<CreatedInvite> {
  assertAdmin(scope);

  const existingMember = await prisma.membership.findFirst({
    where: { workspaceId: scope.workspaceId, user: { email } },
    select: { id: true },
  });
  if (existingMember) {
    throw new AppError('CONFLICT', 'That person is already on your team');
  }

  // 32 bytes of entropy, base64url — not guessable, and safe in a URL.
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  // Re-inviting the same address replaces the old invite rather than
  // accumulating rows; the previous link stops working, which is the
  // behaviour an admin expects when they "resend".
  const invite = await prisma.invite.upsert({
    where: {
      workspaceId_email: { workspaceId: scope.workspaceId, email },
    },
    create: {
      workspaceId: scope.workspaceId,
      email,
      role,
      tokenHash: hashToken(rawToken),
      invitedById: scope.userId,
      expiresAt,
    },
    update: {
      role,
      tokenHash: hashToken(rawToken),
      invitedById: scope.userId,
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });

  return { ...invite, url: inviteUrl(rawToken) };
}

export type InvitePreview = {
  email: string;
  role: Role;
  workspaceName: string;
  /** True when an account already exists for this email. */
  hasAccount: boolean;
};

/**
 * Resolves a raw token for the accept screen.
 *
 * Every failure mode returns the same error. Distinguishing "expired" from
 * "revoked" from "never existed" would let someone probe which tokens were
 * ever real.
 */
export async function previewInvite(rawToken: string): Promise<InvitePreview> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { name: true } },
    },
  });

  if (
    !invite ||
    invite.acceptedAt ||
    invite.revokedAt ||
    invite.expiresAt < new Date()
  ) {
    throw new AppError(
      'NOT_FOUND',
      'This invitation link is no longer valid. Ask your admin to send a new one.',
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });

  return {
    email: invite.email,
    role: invite.role,
    workspaceName: invite.workspace.name,
    hasAccount: Boolean(existingUser),
  };
}

export type AcceptedInvite = {
  userId: string;
  workspaceSlug: string;
};

/**
 * Redeems an invite, creating the account if this is a new person.
 *
 * The whole redemption is one transaction. A half-applied accept — membership
 * granted but invite still open, or user created without membership — would
 * leave someone in a state they can't fix themselves.
 *
 * Security note: when the invited address *already* has an account, the
 * supplied password is verified against it before anything is granted.
 * Skipping that check would turn every invite link into an account takeover
 * for that address — possession of the link would be enough to sign in as an
 * existing user and reach every other workspace they belong to.
 */
export async function acceptInvite(
  rawToken: string,
  input: { name: string; password: string },
): Promise<AcceptedInvite> {
  const tokenHash = hashToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        workspaceId: true,
        workspace: { select: { slug: true } },
      },
    });

    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt < new Date()
    ) {
      throw new AppError(
        'NOT_FOUND',
        'This invitation link is no longer valid. Ask your admin to send a new one.',
      );
    }

    const existing = await tx.user.findUnique({
      where: { email: invite.email },
      select: { id: true, passwordHash: true },
    });

    let user: { id: string };

    if (existing) {
      // Joining a second workspace is a sign-in, so it needs the same proof
      // a sign-in needs.
      const correct = await verifyPassword(existing.passwordHash, input.password);
      if (!correct) {
        throw new AppError(
          'UNAUTHENTICATED',
          'That email already has an account. Enter its existing password to join.',
        );
      }
      user = { id: existing.id };
    } else {
      user = await tx.user.create({
        data: {
          email: invite.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
        },
        select: { id: true },
      });
    }

    await tx.membership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: invite.workspaceId,
          userId: user.id,
        },
      },
      create: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
      },
      update: {},
    });

    // Marking accepted inside the transaction is what makes the link
    // single-use: a concurrent second redemption sees it already consumed.
    await tx.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    return { userId: user.id, workspaceSlug: invite.workspace.slug };
  });
}

export async function revokeInvite(
  scope: Scope,
  inviteId: string,
): Promise<void> {
  assertAdmin(scope);

  const result = await prisma.invite.updateMany({
    // workspaceId in the filter so an id from another tenant can't be revoked.
    where: { id: inviteId, workspaceId: scope.workspaceId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) throw new AppError('NOT_FOUND', 'Invitation not found');
}

export async function listPendingInvites(scope: Scope) {
  return prisma.invite.findMany({
    where: {
      workspaceId: scope.workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Unused today, but the correct primitive if we ever compare tokens directly. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
