import { serverEnv } from '@superdesk/shared/env';
import { emailProvider, workspaceFromAddress } from './provider';

/**
 * Sends an agent's reply as an actual email and returns the Message-ID it was
 * sent under.
 *
 * The caller persists that id on the Message row's `emailMessageId` — the
 * same field inbound parsing reads back out of In-Reply-To/References to
 * find this thread again. Outbound and inbound threading share one
 * mechanism because they're the same problem: "which Message-ID does this
 * one point at."
 */
export async function sendReplyEmail(input: {
  workspaceName: string;
  inboundAlias: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** The Message-ID this reply is directly answering, if any. */
  inReplyTo?: string;
  /** The full prior chain, oldest first — In-Reply-To appended in by the caller if not already last. */
  references: string[];
}): Promise<{ messageId: string; references: string }> {
  const env = serverEnv();
  const messageId = `<${crypto.randomUUID()}@${env.OUTBOUND_EMAIL_DOMAIN}>`;

  const chain = [...input.references];
  if (input.inReplyTo && !chain.includes(input.inReplyTo)) chain.push(input.inReplyTo);
  const references = chain.join(' ');

  const headers: Record<string, string> = { 'Message-ID': messageId };
  if (input.inReplyTo) headers['In-Reply-To'] = input.inReplyTo;
  if (references) headers['References'] = references;

  await emailProvider().send({
    to: input.toEmail,
    from: workspaceFromAddress(input.workspaceName, input.inboundAlias),
    subject: input.subject,
    html: input.bodyHtml,
    text: input.bodyText,
    headers,
  });

  return { messageId, references };
}
