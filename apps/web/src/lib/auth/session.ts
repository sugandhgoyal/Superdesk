import { cookies, headers } from 'next/headers';
import { prisma } from '@superdesk/db';
import { serverEnv } from '@superdesk/shared/env';
import { unauthenticated } from '@superdesk/shared/errors';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from './token';

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  sessionId: string;
};

/**
 * Issues a session: a row in Postgres plus a signed cookie pointing at it.
 *
 * Storing the row is what lets an admin revoke access immediately. A pure
 * stateless JWT stays valid until it expires, which means removing someone
 * from the team wouldn't actually lock them out for up to a week.
 */
export async function createSession(userId: string): Promise<void> {
  const env = serverEnv();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const headerList = await headers();
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      userAgent: headerList.get('user-agent')?.slice(0, 512) ?? null,
      // Vercel and Railway both sit behind proxies; the left-most entry is the
      // original client.
      ip:
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ??
        null,
    },
    select: { id: true },
  });

  const token = await signSessionToken(
    { sub: userId, sid: session.id },
    env.AUTH_SECRET,
    expiresAt,
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

/**
 * Resolves the current user, validating the session row as well as the
 * signature. Returns null rather than throwing so callers can decide whether
 * anonymous access is acceptable.
 */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token, serverEnv().AUTH_SECRET);
  if (!claims) return null;

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: { id: true, email: true, name: true, avatarUrl: true },
      },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    // Guards against a signed token whose sid was reassigned somehow.
    session.userId !== claims.sub
  ) {
    return null;
  }

  // Cheap last-seen tracking. Fire-and-forget: a failure here must never break
  // an otherwise valid request.
  void prisma.session
    .update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    avatarUrl: session.user.avatarUrl,
    sessionId: session.id,
  };
}

export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const claims = await verifySessionToken(token, serverEnv().AUTH_SECRET);
    if (claims) {
      await prisma.session
        .update({
          where: { id: claims.sid },
          data: { revokedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}

/** Revokes every session for a user — used when access is withdrawn. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
