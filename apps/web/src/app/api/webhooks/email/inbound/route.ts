import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { serverEnv } from '@superdesk/shared/env';
import { logger } from '@superdesk/shared/logger';
import { parseGenericJson, parseMailgunForm, processInboundEmail } from '@/lib/email/inbound';

export const runtime = 'nodejs';

/**
 * Inbound mail webhook.
 *
 * Auth is a shared secret in the query string rather than a provider-specific
 * request signature (Mailgun's HMAC-over-timestamp+token, Resend's Svix
 * signing) — the URL configured in whichever provider's dashboard is the one
 * thing that has to exist regardless of which provider ends up wired up, and
 * a constant-time-compared secret is the one verification scheme that works
 * identically for all of them, including the generic JSON shape this route
 * also accepts for testing without a live provider at all. Documented
 * trade-off: the secret can appear in access logs, mitigated by treating
 * those as sensitive and by HTTPS being the only way to reach this route.
 */
function secretMatches(req: NextRequest): boolean {
  const configured = serverEnv().INBOUND_WEBHOOK_SECRET;
  if (!configured) return false;

  const provided = req.nextUrl.searchParams.get('secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid secret' } }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  let parsed;
  try {
    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      parsed = parseMailgunForm(await req.formData());
    } else if (contentType.includes('application/json')) {
      parsed = parseGenericJson(await req.json());
    } else {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Unsupported content type' } },
        { status: 400 },
      );
    }
  } catch (err) {
    logger.error('Failed to parse inbound email payload', err);
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Malformed payload' } }, { status: 400 });
  }

  try {
    const result = await processInboundEmail(parsed);
    // Acknowledge with 200 even for a business-level rejection (unknown
    // recipient, duplicate delivery) — a webhook that 4xxs/5xxs on those
    // teaches the provider to retry something that will never succeed.
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Inbound email processing failed', err, {
      providerMessageId: parsed.providerMessageId,
    });
    // This one *is* worth a retry — it's our own failure, not a fact about
    // the email.
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Failed to process' } },
      { status: 500 },
    );
  }
}
