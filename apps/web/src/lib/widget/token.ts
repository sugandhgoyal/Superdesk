import { SignJWT, jwtVerify } from 'jose';

/**
 * Widget auth — separate from the agent session system on purpose.
 *
 * A website visitor talking to the chat widget is not a user account: there's
 * no password, no membership row, nothing to revoke a session against. The
 * token just has to prove "this browser is the same one that started this
 * conversation" well enough to stop a stranger from reading someone else's
 * chat by guessing a conversation id. It carries no cookie (the widget runs
 * in a cross-site iframe, where third-party cookies are increasingly
 * unreliable) — it's held in the iframe's memory/localStorage and sent as a
 * Bearer token instead.
 *
 * Blast radius of a leaked token is one visitor's own support conversation,
 * not an account — that's what justifies the long, non-revocable expiry
 * below. A stolen agent session is a very different risk and stays on the
 * short-lived, DB-backed system in lib/auth.
 */

const WIDGET_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type WidgetClaims = {
  workspaceId: string;
  contactId: string;
  visitorId: string;
};

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueWidgetToken(
  claims: WidgetClaims,
  secret: string,
): Promise<string> {
  return new SignJWT({
    wsid: claims.workspaceId,
    cid: claims.contactId,
    vid: claims.visitorId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + WIDGET_TOKEN_TTL_SECONDS)
    .sign(signingKey(secret));
}

export async function verifyWidgetToken(
  token: string,
  secret: string,
): Promise<WidgetClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), {
      algorithms: ['HS256'],
    });
    if (
      typeof payload.wsid !== 'string' ||
      typeof payload.cid !== 'string' ||
      typeof payload.vid !== 'string'
    ) {
      return null;
    }
    return { workspaceId: payload.wsid, contactId: payload.cid, visitorId: payload.vid };
  } catch {
    return null;
  }
}
