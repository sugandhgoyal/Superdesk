import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@superdesk/shared/logger';
import { parseGenericJson, parseMailgunForm, processInboundEmail } from '@/lib/email/inbound';
import { inboundSecretMatches } from '@/lib/email/webhook-auth';

export const runtime = 'nodejs';

/**
 * Inbound mail webhook — Mailgun's multipart form shape, or the generic JSON
 * shape used for testing without a live provider. Resend has its own route
 * (../resend) since its webhook is a fundamentally different shape: metadata
 * only, requiring a follow-up API call to fetch the actual email content.
 *
 * See lib/email/webhook-auth.ts for why auth here is a shared secret rather
 * than a provider-specific request signature.
 */
export async function POST(req: NextRequest) {
  if (!inboundSecretMatches(req)) {
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
