import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serverEnv } from '@superdesk/shared/env';

/**
 * Shared secret in the query string, constant-time compared — the one
 * verification scheme that works identically regardless of which email
 * provider is calling (Mailgun's HMAC-over-timestamp+token and Resend's
 * Svix signing are both provider-specific; this is neither). See the
 * comment on the original inbound route for the full reasoning. Used by
 * every inbound-email webhook route, not just one, now that there's more
 * than one provider wired up.
 */
export function inboundSecretMatches(req: NextRequest): boolean {
  const configured = serverEnv().INBOUND_WEBHOOK_SECRET;
  if (!configured) return false;

  const provided = req.nextUrl.searchParams.get('secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
