import { serverEnv } from '@superdesk/shared/env';
import { emailProvider } from './provider';
import { escapeHtml } from '@/lib/sanitize';

/**
 * Transactional invite email.
 *
 * Plain HTML with inline styles rather than a template library — mail clients
 * strip <style> blocks and there's no point pulling in a rendering dependency
 * for two messages.
 */
export async function sendInviteEmail(input: {
  to: string;
  inviterName: string;
  url: string;
}): Promise<boolean> {
  const env = serverEnv();
  const inviter = escapeHtml(input.inviterName);

  const text = [
    `${input.inviterName} invited you to join their team on SuperDesk.`,
    '',
    'Accept the invitation:',
    input.url,
    '',
    'This link expires in 7 days. If you were not expecting it, you can ignore this email.',
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#14161a">
  <h1 style="font-size:20px;margin:0 0 12px">You've been invited</h1>
  <p style="font-size:15px;line-height:1.5;color:#5f6673;margin:0 0 24px">
    ${inviter} invited you to join their team on SuperDesk.
  </p>
  <a href="${input.url}"
     style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:15px;font-weight:500">
    Accept invitation
  </a>
  <p style="font-size:13px;color:#8b93a1;margin:24px 0 0;line-height:1.5">
    This link expires in 7 days. If you weren't expecting it, you can ignore this email.
  </p>
</div>`.trim();

  await emailProvider().send({
    to: input.to,
    from: `SuperDesk <noreply@${env.OUTBOUND_EMAIL_DOMAIN}>`,
    subject: `${input.inviterName} invited you to SuperDesk`,
    html,
    text,
  });

  return true;
}
