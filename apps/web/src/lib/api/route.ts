import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverEnv } from '@superdesk/shared/env';
import { AppError, isAppError } from '@superdesk/shared/errors';
import { Logger, logger, newRequestId } from '@superdesk/shared/logger';
import { TenantError } from '@superdesk/db/tenant';
import { getCurrentUser, type AuthedUser } from '@/lib/auth/session';
import { rateLimit } from '@/lib/ratelimit';

/**
 * One wrapper every API route goes through.
 *
 * Centralising this is what keeps the cross-cutting concerns from being
 * "remembered" per route: input validation, auth, CSRF origin checks, rate
 * limiting, structured logging with a correlation id, and — most importantly —
 * an error boundary that turns anything unexpected into a clean 500 instead of
 * leaking a stack trace or a Postgres constraint name to the browser.
 */

type Ctx<TBody, TQuery> = {
  req: NextRequest;
  body: TBody;
  query: TQuery;
  user: AuthedUser;
  log: Logger;
  requestId: string;
  params: Record<string, string>;
};

type AnonCtx<TBody, TQuery> = Omit<Ctx<TBody, TQuery>, 'user'> & {
  user: AuthedUser | null;
};

type RouteConfig<TBody, TQuery, TAuth extends boolean> = {
  /** Require a signed-in user. Defaults to true — opting out is explicit. */
  auth?: TAuth;
  body?: z.ZodType<TBody>;
  query?: z.ZodType<TQuery>;
  rateLimit?: { limit: number; windowSeconds: number; bucket?: string };
  handler: (
    ctx: TAuth extends false ? AnonCtx<TBody, TQuery> : Ctx<TBody, TQuery>,
  ) => Promise<unknown>;
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence layer two.
 *
 * SameSite=Lax already blocks cross-site form POSTs. This catches the rest:
 * any state-changing request must carry an Origin header matching our own.
 * Browsers set Origin on all mutating requests and it can't be spoofed by
 * page JavaScript, which is what makes it a usable signal.
 */
function assertSameOrigin(req: NextRequest): void {
  if (!MUTATING.has(req.method)) return;

  const origin = req.headers.get('origin');
  if (!origin) {
    // Non-browser clients (curl, the gateway's internal calls) send no Origin.
    // Those authenticate with a bearer secret instead, checked separately.
    return;
  }

  const allowed = new Set([serverEnv().APP_URL, req.nextUrl.origin]);
  if (!allowed.has(origin)) {
    throw new AppError('FORBIDDEN', 'Cross-origin request rejected', {
      context: { origin },
    });
  }
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export function defineRoute<TBody = undefined, TQuery = undefined>(
  config: RouteConfig<TBody, TQuery, true>,
): (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;
export function defineRoute<TBody = undefined, TQuery = undefined>(
  config: RouteConfig<TBody, TQuery, false>,
): (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;
export function defineRoute<TBody, TQuery>(
  config: RouteConfig<TBody, TQuery, boolean>,
) {
  return async function handler(
    req: NextRequest,
    routeCtx?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> {
    const requestId = newRequestId();
    const started = Date.now();
    const log = logger.child({
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
    });

    try {
      assertSameOrigin(req);

      const params = (await routeCtx?.params) ?? {};

      const requireAuth = config.auth !== false;
      const user = await getCurrentUser();
      if (requireAuth && !user) {
        throw new AppError('UNAUTHENTICATED', 'You need to sign in');
      }

      if (config.rateLimit) {
        // Authenticated callers are limited per user; anonymous ones per IP.
        const identity = user ? `u:${user.id}` : `ip:${clientIp(req)}`;
        const bucket = config.rateLimit.bucket ?? req.nextUrl.pathname;
        const result = await rateLimit(
          `rl:${bucket}:${identity}`,
          config.rateLimit.limit,
          config.rateLimit.windowSeconds,
        );

        if (!result.allowed) {
          log.warn('Rate limit exceeded', { bucket, identity });
          return NextResponse.json(
            {
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests — try again shortly',
                requestId,
              },
            },
            {
              status: 429,
              headers: {
                'Retry-After': String(
                  Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
                ),
                'X-Request-Id': requestId,
              },
            },
          );
        }
      }

      let body = undefined as TBody;
      if (config.body) {
        const raw = await req.json().catch(() => {
          throw new AppError('BAD_REQUEST', 'Request body must be valid JSON');
        });
        const parsed = config.body.safeParse(raw);
        if (!parsed.success) {
          throw new AppError('BAD_REQUEST', firstIssue(parsed.error), {
            context: { issues: parsed.error.issues },
          });
        }
        body = parsed.data;
      }

      let query = undefined as TQuery;
      if (config.query) {
        const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
        const parsed = config.query.safeParse(raw);
        if (!parsed.success) {
          throw new AppError('BAD_REQUEST', firstIssue(parsed.error), {
            context: { issues: parsed.error.issues },
          });
        }
        query = parsed.data;
      }

      const result = await config.handler({
        req,
        body,
        query,
        user: user as AuthedUser,
        log,
        requestId,
        params,
      });

      log.info('Request completed', { durationMs: Date.now() - started });

      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true }, {
        headers: { 'X-Request-Id': requestId },
      });
    } catch (err) {
      return handleError(err, log, requestId, started);
    }
  };
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function handleError(
  err: unknown,
  log: Logger,
  requestId: string,
  started: number,
): NextResponse {
  const durationMs = Date.now() - started;

  // Tenant violations are deliberately reported as 404, not 403 — telling a
  // caller "that exists but isn't yours" confirms the id is real.
  if (err instanceof TenantError) {
    log.warn('Tenant boundary rejection', { durationMs, reason: err.message });
    return errorResponse('NOT_FOUND', 404, 'Not found', requestId);
  }

  if (isAppError(err)) {
    const level = err.status >= 500 ? 'error' : 'warn';
    if (level === 'error') {
      log.error('Request failed', err, { durationMs, context: err.context });
    } else {
      log.warn('Request rejected', {
        durationMs,
        code: err.code,
        context: err.context,
      });
    }
    return errorResponse(err.code, err.status, err.publicMessage, requestId);
  }

  // Anything unmodelled: log everything, tell the client nothing beyond an id
  // they can quote in a support request.
  log.error('Unhandled error', err, { durationMs });
  return errorResponse(
    'INTERNAL',
    500,
    'Something went wrong on our end',
    requestId,
  );
}

function errorResponse(
  code: string,
  status: number,
  message: string,
  requestId: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status, headers: { 'X-Request-Id': requestId } },
  );
}
