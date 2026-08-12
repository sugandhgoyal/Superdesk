import { NextRequest, NextResponse } from 'next/server';
import { messagesSince } from '@superdesk/db/tenant';
import { getCurrentUser } from '@/lib/auth/session';
import { scopeFromSlug } from '@/lib/api/scope';
import { pollingEventStream } from '@/lib/sse';

export const runtime = 'nodejs';

/**
 * Same polling-SSE mechanism as the widget's stream, on the agent side —
 * this is what lets an open conversation in the inbox update without the
 * 8-second poll interval InboxClient falls back to when this isn't
 * available (e.g. a network that blocks long-lived connections).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'You need to sign in' } },
      { status: 401 },
    );
  }

  const scope = await scopeFromSlug(user.id, slug).catch(() => null);
  if (!scope) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Not found' } },
      { status: 404 },
    );
  }

  // On reconnect, EventSource automatically resends whatever `id:` field it
  // last saw as a `Last-Event-ID` header — using that (when present) instead
  // of the original query param is what stops every ~8s reconnect from
  // redelivering everything the client already has.
  const afterSeq = Number(
    req.headers.get('last-event-id') ?? req.nextUrl.searchParams.get('afterSeq') ?? '0',
  );
  if (!Number.isFinite(afterSeq)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid afterSeq' } },
      { status: 400 },
    );
  }

  return pollingEventStream({
    afterSeq,
    signal: req.signal,
    poll: async (since) => {
      // Scoped to this workspace by id+workspaceId together — a conversation
      // id from another tenant simply matches nothing, no error to catch.
      const messages = await messagesSince(id, scope.workspaceId, since);
      return messages.map((m) => ({ seq: m.seq, data: m }));
    },
  });
}
