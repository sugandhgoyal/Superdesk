import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/token';

/**
 * Edge middleware — two unrelated jobs sharing one entry point because both
 * need to run before a page renders.
 *
 * 1. Auth gate for dashboard routes (/w/*, /onboarding): checks the session
 *    token's *signature* only, no database call — middleware runs on every
 *    matched request and a Postgres round trip here would tax the whole app.
 *    Cheap redirect optimisation, not the security boundary; pages and API
 *    routes behind it still call `requireUser()`, which validates the
 *    session row and can see revocations.
 *
 * 2. Custom-domain rewrite: a request whose Host header isn't one of our own
 *    domains is a workspace's connected custom domain (Req 7) — resolved via
 *    a tiny cached API lookup rather than a direct DB query, since Edge
 *    middleware can't hold the TCP connection Prisma needs. Matched, it's
 *    rewritten to that workspace's /help/[slug] tree so the same public KB
 *    code serves both help.workspace.com/some-article and
 *    our-app.com/help/workspace/some-article. Unmatched, it 404s outright —
 *    letting it fall through would mean an unaffiliated domain pointed at us
 *    by mistake (or by someone else's DNS misconfiguration) renders our own
 *    homepage or dashboard under their name.
 */

function isOwnHost(hostname: string): boolean {
  const appHost = safeHostname(process.env.APP_URL);
  const kbBaseHost = process.env.KB_BASE_DOMAIN;
  return (
    hostname === appHost ||
    hostname === kbBaseHost ||
    hostname.endsWith('.vercel.app') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );
}

function safeHostname(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

async function resolveCustomDomain(req: NextRequest, hostname: string): Promise<NextResponse> {
  try {
    const lookup = await fetch(new URL(`/api/domains/resolve?host=${encodeURIComponent(hostname)}`, req.url), {
      headers: { 'x-internal-middleware': '1' },
    });
    if (lookup.ok) {
      const { slug } = (await lookup.json()) as { slug: string };
      const url = req.nextUrl.clone();
      url.pathname = `/help/${slug}${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`;
      return NextResponse.rewrite(url);
    }
  } catch {
    // Treated the same as "not found" below — a lookup failure shouldn't
    // serve our own app under someone else's domain either.
  }
  return new NextResponse('Not found', { status: 404 });
}

export async function middleware(req: NextRequest) {
  const hostname = req.nextUrl.hostname;

  if (!isOwnHost(hostname)) {
    return resolveCustomDomain(req, hostname);
  }

  const { pathname } = req.nextUrl;
  if (!(pathname.startsWith('/w/') || pathname === '/onboarding')) {
    return NextResponse.next();
  }

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
