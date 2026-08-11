import { serverEnv } from '@superdesk/shared/env';
import { logger } from '@superdesk/shared/logger';

/**
 * Fixed-window rate limiting.
 *
 * Backed by Upstash over HTTP in production and an in-process Map in local
 * development, so the app runs without Redis configured. The two share an
 * interface; nothing above this file knows which is active.
 *
 * Fixed window rather than sliding: it costs one round trip instead of a
 * sorted-set read/write pair, and the worst case — a caller getting 2x the
 * limit by straddling a window boundary — is irrelevant at the limits we set
 * here. Documented rather than silently accepted.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

interface RateLimitStore {
  incr(key: string, windowSeconds: number): Promise<number>;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; expiresAt: number }>();

  async incr(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.buckets.set(key, {
        count: 1,
        expiresAt: now + windowSeconds * 1000,
      });
      // Opportunistic sweep so a long-lived dev server doesn't grow forever.
      if (this.buckets.size > 5_000) {
        for (const [k, v] of this.buckets) {
          if (v.expiresAt <= now) this.buckets.delete(k);
        }
      }
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }
}

class UpstashStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async incr(key: string, windowSeconds: number): Promise<number> {
    // INCR then EXPIRE in one pipelined call. EXPIRE is unconditional, which
    // would keep pushing the window out on a hot key — NX makes it apply only
    // when no TTL is set, i.e. on the first hit of a window.
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSeconds), 'NX'],
      ]),
      // Never let the limiter become the slowest part of a request.
      signal: AbortSignal.timeout(1_500),
    });

    if (!res.ok) throw new Error(`Upstash responded ${res.status}`);

    const body = (await res.json()) as Array<{ result: number }>;
    return body[0]?.result ?? 1;
  }
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (store) return store;

  const env = serverEnv();
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    store = new UpstashStore(
      env.UPSTASH_REDIS_REST_URL,
      env.UPSTASH_REDIS_REST_TOKEN,
    );
  } else {
    if (env.NODE_ENV === 'production') {
      logger.warn(
        'Rate limiting is running in-memory in production — limits are per-instance only',
      );
    }
    store = new MemoryStore();
  }
  return store;
}

/**
 * Fails open.
 *
 * If Redis is down, the choice is between rejecting every request and
 * accepting unlimited ones. For a support inbox, dropping real customer
 * messages is the worse failure — so we log loudly and let traffic through.
 * An auth endpoint would arguably want the opposite; noted as a limitation.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const resetAt = Date.now() + windowSeconds * 1000;

  try {
    const count = await getStore().incr(key, windowSeconds);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (err) {
    logger.error('Rate limiter unavailable, failing open', err, { key });
    return { allowed: true, remaining: limit, resetAt };
  }
}

/** Limits tuned per surface. Auth is strictest — it's the credential-stuffing target. */
export const LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 },
  inviteSend: { limit: 30, windowSeconds: 3600 },
  widgetBoot: { limit: 60, windowSeconds: 60 },
  widgetMessage: { limit: 30, windowSeconds: 60 },
  aiSummary: { limit: 20, windowSeconds: 3600 },
  kbSearch: { limit: 120, windowSeconds: 60 },
  api: { limit: 300, windowSeconds: 60 },
} as const;
