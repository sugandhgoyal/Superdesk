import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkspaceByDomain } from '@/lib/domains';

export const runtime = 'nodejs';

/**
 * Domain → workspace slug, for middleware's custom-domain rewrite.
 *
 * Deliberately not behind defineRoute — no session to check, and it needs to
 * answer with a plain 404 (not the JSON error envelope) for middleware's
 * `res.ok` check to work as a simple boolean. Cached briefly so a domain
 * getting real traffic doesn't cost a database lookup on every request; a
 * domain that just got connected or disconnected shows the old answer for
 * at most a minute, which is a fine trade for how rarely this changes.
 */
export async function GET(req: NextRequest) {
  const host = req.nextUrl.searchParams.get('host');
  if (!host) return NextResponse.json({ error: 'Missing host' }, { status: 400 });

  const workspace = await resolveWorkspaceByDomain(host.toLowerCase());
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(
    { slug: workspace.slug },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } },
  );
}
