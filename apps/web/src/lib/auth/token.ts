import { SignJWT, jwtVerify } from 'jose';

/**
 * Session token signing and verification.
 *
 * Deliberately free of any Node-only or database imports: middleware runs on
 * the edge runtime and needs to check a token on every request without a
 * Postgres round trip. Anything that touches the database lives in
 * ./session.ts, which is server-runtime only.
 */

export const SESSION_COOKIE = 'sd_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = {
  /** User id. */
  sub: string;
  /** Session row id — the handle that makes revocation possible. */
  sid: string;
};

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  claims: SessionClaims,
  secret: string,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey(secret));
}

/**
 * Verifies the signature and expiry only.
 *
 * A token that passes here is authentic but may still reference a session that
 * has since been revoked — routes that mutate data must call
 * `loadSession()` to check. This split is intentional: reads get a fast
 * signature check, writes pay for the revocation guarantee.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), {
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      return null;
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true, // JavaScript can never read it — blunts XSS token theft
    secure: process.env.NODE_ENV === 'production',
    // Lax rather than Strict: Strict would drop the cookie when an agent
    // follows an emailed invite link, logging them out mid-flow. Lax still
    // blocks the cross-site POSTs that CSRF depends on, and the Origin check
    // in the route wrapper covers the rest.
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
