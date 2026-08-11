import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/token';

/**
 * Edge-side gate for dashboard routes.
 *
 * This checks the token's *signature* only — no database call, because
 * middleware runs on every request including static assets and a Postgres
 * round trip here would tax the whole app. It is a cheap filter that stops
 * unauthenticated traffic before it reaches a server component; the pages and
 * API routes behind it still call `requireUser()`, which validates the session
 * row and can see revocations.
 *
 * Treating this as the only auth check would be a real vulnerability. It's a
 * redirect optimisation, not the security boundary.
 */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    // Misconfiguration should be loud, not silently permissive.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'AUTH_SECRET missing — refusing to authorize request',
      }),
    );
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const claims = token ? await verifySessionToken(token, secret) : null;

  if (!claims) {
    const loginUrl = new URL('/login', req.url);
    // Preserve where they were headed so login can send them back.
    loginUrl.searchParams.set(
      'next',
      req.nextUrl.pathname + req.nextUrl.search,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Only workspace routes are gated. Deliberately excluded:
   *   /api/*      — routes authenticate themselves and must return JSON 401s,
   *                 not HTML redirects
   *   /help/*     — the public knowledge base
   *   /widget/*   — the embeddable chat widget
   *   /login, /signup, /invite
   */
  matcher: ['/w/:path*', '/onboarding'],
};
