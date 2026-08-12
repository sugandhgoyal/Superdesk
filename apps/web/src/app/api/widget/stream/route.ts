import { NextRequest, NextResponse } from 'next/server';
import { messagesSince } from '@superdesk/db/tenant';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { authenticateWidget } from '@/lib/widget/session';
import { prisma } from '@superdesk/db';
import { pollingEventStream } from '@/lib/sse';

export const runtime = 'nodejs';

/**
 * EventSource can't set headers, so the token travels as a query param
 * instead of the usual Authorization header. It's a short-lived proof of
 * "this browser owns this one support conversation" rather than an account
 * credential, and it never appears anywhere but this one same-origin
 * request — logged server-side access logs are the one real exposure, same
 * as any query-param token.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  // See the agent-side stream route for why Last-Event-ID takes priority.
  const afterSeq = Number(
    req.headers.get('last-event-id') ?? req.nextUrl.searchParams.get('afterSeq') ?? '0',
  );

  if (!token || !conversationId || !Number.isFinite(afterSeq)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Missing token or conversationId' } },
      { status: 400 },
    );
  }

  const scope = await authenticateWidget(token).catch(() => null);
  if (!scope) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired widget session' } },
      { status: 401 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = await rateLimit(`rl:widget-stream:ip:${ip}`, LIMITS.widgetBoot.limit, LIMITS.widgetBoot.windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429 },
    );
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId, contactId: scope.contactId },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
      { status: 404 },
    );
  }

  return pollingEventStream({
    afterSeq,
    signal: req.signal,
    poll: async (since) => {
      const messages = await messagesSince(conversationId, scope.workspaceId, since);
      // The widget must never see a private note, streamed or otherwise.
      return messages
        .filter((m) => !m.isPrivateNote)
        .map((m) => ({ seq: m.seq, data: m }));
    },
  });
}
