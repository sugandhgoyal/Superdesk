/**
 * Server-Sent Events, built on polling instead of a subscription.
 *
 * The "real" way to push new rows to a client is to subscribe to them —
 * Postgres LISTEN/NOTIFY, Redis pub/sub, a message broker. All three need a
 * connection that outlives a single request, which a Vercel serverless
 * function fundamentally can't hold. So each connection here does the next
 * best thing: poll for anything newer than the client's last-seen `seq`
 * every `intervalMs`, stream what it finds, and close itself well inside the
 * platform's execution-time ceiling. `EventSource` reconnects automatically
 * when a connection ends — `retry: 500` (below) keeps that gap short — so a
 * short-lived stream and a long-lived one look the same from the browser's
 * side: a steady flow of events arriving within a second or two of being
 * written, no client-side reconnect logic required.
 */

type StreamItem<T> = { seq: number; data: T };

export function pollingEventStream<T>(opts: {
  /** Fetch anything newer than `afterSeq`. Return [] when there's nothing new. */
  poll: (afterSeq: number) => Promise<StreamItem<T>[]>;
  /** The seq the client already has — only items after this are sent. */
  afterSeq: number;
  /** Aborts when the client disconnects, so polling doesn't run past that. */
  signal?: AbortSignal;
  /** Self-close well under Vercel's function-duration ceiling; the client reconnects. */
  durationMs?: number;
  intervalMs?: number;
}): Response {
  const { poll, signal, durationMs = 8_000, intervalMs = 1_500 } = opts;
  let lastSeq = opts.afterSeq;
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the other race arm — fine.
        }
      };

      signal?.addEventListener('abort', close);
      controller.enqueue(encoder.encode('retry: 500\n\n'));

      const tick = async () => {
        if (closed) return;
        if (Date.now() - startedAt >= durationMs) return close();

        try {
          const items = await poll(lastSeq);
          if (closed) return;
          for (const item of items) {
            lastSeq = Math.max(lastSeq, item.seq);
            controller.enqueue(
              encoder.encode(`id: ${item.seq}\ndata: ${JSON.stringify(item.data)}\n\n`),
            );
          }
          if (items.length === 0) {
            controller.enqueue(encoder.encode(': ping\n\n'));
          }
        } catch {
          return close();
        }

        if (!closed) setTimeout(tick, intervalMs);
      };

      setTimeout(tick, intervalMs);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables response buffering on Vercel's proxy layer — without this,
      // chunks can sit in a buffer instead of reaching the browser as written.
      'X-Accel-Buffering': 'no',
    },
  });
}
