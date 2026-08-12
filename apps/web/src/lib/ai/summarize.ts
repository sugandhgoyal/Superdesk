import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '@superdesk/db';
import { TenantError, type Scope } from '@superdesk/db/tenant';
import { serverEnv, features } from '@superdesk/shared/env';
import { AppError } from '@superdesk/shared/errors';
import { logger } from '@superdesk/shared/logger';
import { rateLimit } from '@/lib/ratelimit';

/**
 * AI conversation summarization — incremental, with an extractive fallback.
 *
 * "Incremental" means the model only ever sees the messages since the last
 * summary plus that prior summary's own text, not the whole thread from
 * scratch — `ConversationSummary.upToSeq` is the bookmark that makes this
 * possible. A 200-message thread costs the same per-refresh as a 5-message
 * one; the summary itself carries the accumulated context forward.
 *
 * Structured output comes from a forced tool call (`tool_choice` pinned to
 * one tool) rather than asking for JSON in prose and hoping — the model
 * can't return anything else, and the shape is validated again on our side
 * with zod before it's trusted.
 *
 * `degraded: true` marks a summary produced without calling the model at
 * all — no ANTHROPIC_API_KEY configured, the workspace hit its hourly cap,
 * or the API call itself failed. The inbox still gets *something* useful
 * instead of an error, built from the same messages a real summary would
 * have used.
 */

const summarySchema = z.object({
  whatUserWants: z.string(),
  whatsBeenTried: z.string(),
  currentStatus: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'negative']),
  suggestedNextStep: z.string(),
});

export type ConversationSummaryShape = z.infer<typeof summarySchema>;

const TOOL_NAME = 'record_summary';

const SUMMARY_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    whatUserWants: { type: 'string', description: "The customer's underlying goal or problem, in one or two sentences." },
    whatsBeenTried: { type: 'string', description: 'What the team (or the customer) has already attempted, briefly.' },
    currentStatus: { type: 'string', description: 'Where things stand right now — waiting on whom, for what.' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'frustrated', 'negative'], description: "The customer's current emotional tone." },
    suggestedNextStep: { type: 'string', description: 'The single most useful thing the agent should do next.' },
  },
  required: ['whatUserWants', 'whatsBeenTried', 'currentStatus', 'sentiment', 'suggestedNextStep'],
};

const SYSTEM_PROMPT = `You summarize customer-support conversations for the agent picking them up. Be concrete and brief — a teammate skimming this should understand the situation in five seconds. Base every field only on what's actually in the conversation; don't invent details. Call the record_summary tool with your answer.`;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
  return client;
}

type SummarizableMessage = {
  seq: number;
  senderType: 'CONTACT' | 'AGENT' | 'SYSTEM' | 'AI';
  bodyText: string;
  isPrivateNote: boolean;
};

/**
 * A best-effort summary with no model call — pattern-matched from whichever
 * messages are actually available, not a placeholder. Kept close to what a
 * real summary would say for a short thread, which is exactly the case this
 * fires most often (no API key configured at all, e.g. this deployment).
 */
function extractiveFallback(
  messages: SummarizableMessage[],
  prior: ConversationSummaryShape | null,
): ConversationSummaryShape {
  const fromContact = messages.filter((m) => m.senderType === 'CONTACT');
  const fromAgent = messages.filter((m) => m.senderType === 'AGENT' && !m.isPrivateNote);

  return {
    whatUserWants:
      fromContact[0]?.bodyText.slice(0, 220) ?? prior?.whatUserWants ?? 'No customer message yet.',
    whatsBeenTried: fromAgent.length
      ? fromAgent.map((m) => m.bodyText.slice(0, 120)).join(' · ').slice(0, 320)
      : prior?.whatsBeenTried ?? 'No agent reply yet.',
    currentStatus: prior
      ? `${messages.length} new message${messages.length === 1 ? '' : 's'} since the last summary.`
      : `${messages.length} message${messages.length === 1 ? '' : 's'} in the conversation so far.`,
    sentiment: prior?.sentiment ?? 'neutral',
    suggestedNextStep: prior?.suggestedNextStep ?? 'Review the conversation and respond.',
  };
}

async function persist(
  conversationId: string,
  summary: ConversationSummaryShape,
  upToSeq: number,
  model: string,
  inputTokens: number | null,
  degraded: boolean,
) {
  return prisma.conversationSummary.upsert({
    where: { conversationId },
    update: { summary, upToSeq, model, inputTokens, degraded },
    create: { conversationId, summary, upToSeq, model, inputTokens, degraded },
  });
}

export async function summarizeConversation(scope: Scope, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: {
      msgSeq: true,
      summary: { select: { summary: true, upToSeq: true } },
    },
  });
  if (!conversation) throw new TenantError('Conversation not found');

  const priorSummary = (conversation.summary?.summary as ConversationSummaryShape | undefined) ?? null;
  const sinceSeq = conversation.summary?.upToSeq ?? 0;

  if (conversation.msgSeq <= sinceSeq) {
    // Nothing happened since the last summary — it's already current.
    return prisma.conversationSummary.findUniqueOrThrow({ where: { conversationId } });
  }

  const newMessages = await prisma.message.findMany({
    where: { conversationId, seq: { gt: sinceSeq } },
    orderBy: { seq: 'asc' },
    select: { seq: true, senderType: true, bodyText: true, isPrivateNote: true },
  });

  if (!features().ai) {
    const fallback = extractiveFallback(newMessages, priorSummary);
    return persist(conversationId, fallback, conversation.msgSeq, 'extractive-fallback', null, true);
  }

  const budget = await rateLimit(
    `rl:ai-summary:${scope.workspaceId}`,
    serverEnv().AI_SUMMARY_HOURLY_LIMIT,
    3600,
  );
  if (!budget.allowed) {
    throw new AppError('RATE_LIMITED', "This workspace's AI summary limit is reached for this hour");
  }

  try {
    const model = serverEnv().AI_MODEL;
    // Private notes ARE included here, unlike every customer-facing surface
    // (widget, outbound email) — this summary is for the agent picking the
    // thread up, and "already escalated to billing" is exactly the kind of
    // internal context they need.
    const transcript = newMessages
      .map((m) => `[${m.senderType}${m.isPrivateNote ? ' — internal note' : ''}] ${m.bodyText}`)
      .join('\n\n');

    const userContent = priorSummary
      ? `Prior summary of this conversation:\n${JSON.stringify(priorSummary, null, 2)}\n\nNew activity since then:\n\n${transcript}\n\nUpdate the summary to reflect the full conversation to date.`
      : `Conversation so far:\n\n${transcript}\n\nSummarize this support conversation.`;

    const response = await anthropic().messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: 'Record the structured summary.', input_schema: SUMMARY_TOOL_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Model response had no tool_use block');
    }

    const parsed = summarySchema.parse(toolUse.input);
    return persist(conversationId, parsed, conversation.msgSeq, model, response.usage?.input_tokens ?? null, false);
  } catch (err) {
    logger.error('AI summarization failed — falling back to extractive summary', err, {
      conversationId,
      workspaceId: scope.workspaceId,
    });
    const fallback = extractiveFallback(newMessages, priorSummary);
    return persist(conversationId, fallback, conversation.msgSeq, 'extractive-fallback', null, true);
  }
}
