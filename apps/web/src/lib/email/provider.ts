import { serverEnv } from '@superdesk/shared/env';
import { AppError } from '@superdesk/shared/errors';
import { logger } from '@superdesk/shared/logger';

/**
 * Outbound email, behind one interface.
 *
 * Providers differ mostly in how they spell "send" and how they let you set
 * raw headers — and setting Message-ID / In-Reply-To / References is
 * non-negotiable for us, since that's what keeps a customer's replies stitched
 * to the right conversation. Anything that can't do that isn't a candidate.
 *
 * Swapping provider is a config change, not a code change. That mattered when
 * choosing between Resend, Mailgun and Postmark under time pressure: the
 * decision stayed reversible.
 */

export type OutboundEmail = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** RFC 5322 headers — this is how threading actually works. */
  headers?: Record<string, string>;
};

export type SendResult = {
  /** The provider's own id, for reconciling with their dashboard. */
  providerId: string;
};

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * Local/unconfigured mode: logs the message instead of sending it.
 *
 * Keeps the whole email path exercisable in development without a provider
 * account or a verified domain — the code path, headers and threading logic
 * are identical, only delivery is stubbed.
 */
class ConsoleProvider implements EmailProvider {
  readonly name = 'console';

  async send(email: OutboundEmail): Promise<SendResult> {
    logger.info('[email:console] would send', {
      to: email.to,
      from: email.from,
      subject: email.subject,
      headers: email.headers,
      preview: email.text.slice(0, 200),
    });
    return { providerId: `console-${crypto.randomUUID()}` };
  }
}

class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly apiKey: string) {}

  async send(email: OutboundEmail): Promise<SendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not send the email', {
        context: { provider: 'resend', status: res.status, detail: detail.slice(0, 300) },
      });
    }

    const body = (await res.json()) as { id: string };
    return { providerId: body.id };
  }
}

class MailgunProvider implements EmailProvider {
  readonly name = 'mailgun';

  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
  ) {}

  async send(email: OutboundEmail): Promise<SendResult> {
    const form = new FormData();
    form.set('from', email.from);
    form.set('to', email.to);
    form.set('subject', email.subject);
    form.set('html', email.html);
    form.set('text', email.text);
    if (email.replyTo) form.set('h:Reply-To', email.replyTo);
    // Mailgun takes arbitrary headers via the h: prefix.
    for (const [key, value] of Object.entries(email.headers ?? {})) {
      form.set(`h:${key}`, value);
    }

    const res = await fetch(
      `https://api.mailgun.net/v3/${this.domain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
        },
        body: form,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not send the email', {
        context: { provider: 'mailgun', status: res.status, detail: detail.slice(0, 300) },
      });
    }

    const body = (await res.json()) as { id: string };
    return { providerId: body.id };
  }
}

let cached: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (cached) return cached;

  const env = serverEnv();

  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      if (!env.RESEND_API_KEY) {
        logger.warn('EMAIL_PROVIDER=resend but no API key — falling back to console');
        cached = new ConsoleProvider();
        break;
      }
      cached = new ResendProvider(env.RESEND_API_KEY);
      break;

    case 'mailgun':
      if (!env.MAILGUN_API_KEY) {
        logger.warn('EMAIL_PROVIDER=mailgun but no API key — falling back to console');
        cached = new ConsoleProvider();
        break;
      }
      cached = new MailgunProvider(env.MAILGUN_API_KEY, env.OUTBOUND_EMAIL_DOMAIN);
      break;

    default:
      cached = new ConsoleProvider();
  }

  return cached;
}

/** The address replies to this workspace should come back to. */
export function workspaceFromAddress(
  workspaceName: string,
  inboundAlias: string,
): string {
  const env = serverEnv();
  // Quote the display name so a comma or quote in a workspace name can't
  // break out and forge extra addresses in the header.
  const safeName = workspaceName.replace(/["\\]/g, '').slice(0, 60);
  return `"${safeName}" <${inboundAlias}@${env.INBOUND_EMAIL_DOMAIN}>`;
}
