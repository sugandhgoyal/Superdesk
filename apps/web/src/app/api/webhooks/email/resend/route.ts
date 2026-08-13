import { NextRequest, NextResponse } from 'next/server';
import { serverEnv } from '@superdesk/shared/env';
import { logger } from '@superdesk/shared/logger';
import { parseResendWebhook, processInboundEmail } from '@/lib/email/inbound';
import { inboundSecretMatches } from '@/lib/email/webhook-auth';

export const runtime = 'nodejs';

/**
 * Resend's inbound webhook. Separate route from the Mailgun/generic one —
 * Resend's payload is a fundamentally different shape (metadata only, a
 * follow-up API call needed for content) rather than something that fits
 * the same content-type sniff. Same shared-secret auth either way.
 */
export async function POST(req: NextRequest) {
  if (!inboundSecretMatches(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid secret' } }, { status: 401 });
  }

  if (!serverEnv().RESEND_API_KEY) {
    logger.error('Resend inbound webhook received but RESEND_API_KEY is not configured');
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Not configured' } }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (err) {
    logger.error('Failed to parse Resend webhook body', err);
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Malformed payload' } }, { status: 400 });
  }

  let parsed;
  try {
    parsed = await parseResendWebhook(payload);
  } catch (err) {
    logger.error('Failed to fetch received email content from Resend', err);
    // Worth a retry — this is our own fetch failing, not a fact about the email.
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Failed to fetch email content' } }, { status: 500 });
  }

  if (!parsed) {
    // A Resend event type other than email.received, or a payload we
    // couldn't identify an email in — acknowledged, nothing to do.
    return NextResponse.json({ status: 'ignored' });
  }

  try {
    const result = await processInboundEmail(parsed);
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Inbound email processing failed', err, { providerMessageId: parsed.providerMessageId });
    return NextResponse.json({ error: { code: 'INTERNAL', message: 'Failed to process' } }, { status: 500 });
  }
}
