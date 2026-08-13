import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@superdesk/db';
import { TenantError, type Scope } from '@superdesk/db/tenant';
import { serverEnv, features } from '@superdesk/shared/env';
import { AppError } from '@superdesk/shared/errors';
import { logger } from '@superdesk/shared/logger';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { findRelevantArticles } from '@/lib/kb';

/**
 * AI auto-reply drafts — a suggested reply grounded in the conversation and,
 * when relevant, the workspace's own help-center articles.
 *
 * Unlike summarization, there's no sensible non-AI fallback here — a
 * pattern-matched "draft" would just be wrong, not degraded-but-useful. So
 * unlike lib/ai/summarize.ts, this throws outright when AI isn't configured
 * rather than silently returning something worse. The one invariant that
 * does carry over: this only ever *suggests* text into the compose box — the
 * agent reviews and sends it themselves, same as anything else they type.
 * Nothing here calls the send-message path.
 */

const SYSTEM_PROMPT = `You draft replies for a human support agent to review and send — you never send anything yourself. Write in the agent's voice: friendly, concise, accurate. Base your draft only on the conversation and the help-center articles you're given; never invent a policy, price, or fact that isn't there. If the provided articles aren't actually relevant to what the customer is asking, ignore them and draft from the conversation alone. Output only the reply text — no preamble like "Here's a draft:", no signature.`;

const MAX_TRANSCRIPT_MESSAGES = 20;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
  return client;
}

export type DraftReplyResult = {
  draft: string;
  usedArticles: { title: string; slug: string }[];
};

export async function draftReply(scope: Scope, conversationId: string): Promise<DraftReplyResult> {
  if (!features().ai) {
    throw new AppError(
      'UPSTREAM_UNAVAILABLE',
      'AI drafting is not configured on this deployment (no Anthropic API key set).',
    );
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: {
      messages: {
        orderBy: { seq: 'desc' },
        take: MAX_TRANSCRIPT_MESSAGES,
        select: { senderType: true, bodyText: true, isPrivateNote: true },
      },
    },
  });
  if (!conversation) throw new TenantError('Conversation not found');
  if (conversation.messages.length === 0) {
    throw new AppError('BAD_REQUEST', 'Nothing to draft from yet — this conversation has no messages.');
  }

  const chronological = [...conversation.messages].reverse();
  const lastCustomerMessage = conversation.messages.find((m) => m.senderType === 'CONTACT')?.bodyText ?? '';

  const relevant = lastCustomerMessage ? await findRelevantArticles(scope.workspaceId, lastCustomerMessage) : [];

  const budget = await rateLimit(
    `rl:ai-draft:${scope.workspaceId}`,
    LIMITS.aiDraftReply.limit,
    LIMITS.aiDraftReply.windowSeconds,
  );
  if (!budget.allowed) {
    throw new AppError('RATE_LIMITED', "This workspace's AI drafting limit is reached for this hour");
  }

  // Private notes are included, same reasoning as summarization — this is
  // agent-facing, and "we already told them we'd refund it" is exactly the
  // kind of internal context a draft needs to not contradict.
  const transcript = chronological
    .map((m) => `[${m.senderType}${m.isPrivateNote ? ' — internal note' : ''}] ${m.bodyText}`)
    .join('\n\n');

  const articleContext = relevant.length
    ? `\n\nRelevant help center articles:\n\n${relevant.map((a) => `### ${a.title}\n${a.bodyText}`).join('\n\n')}`
    : '';

  try {
    const response = await anthropic().messages.create({
      model: serverEnv().AI_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Conversation so far:\n\n${transcript}${articleContext}\n\nDraft a reply to the customer's most recent message.`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const draft = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
    if (!draft) throw new Error('Model returned no text content');

    return { draft, usedArticles: relevant.map((a) => ({ title: a.title, slug: a.slug })) };
  } catch (err) {
    logger.error('AI draft reply failed', err, { conversationId, workspaceId: scope.workspaceId });
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not generate a draft right now — try again in a moment.');
  }
}
