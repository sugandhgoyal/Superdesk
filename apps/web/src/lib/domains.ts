import { prisma } from '@superdesk/db';
import { assertAdmin, type Scope } from '@superdesk/db/tenant';
import { serverEnv, features } from '@superdesk/shared/env';
import { AppError } from '@superdesk/shared/errors';
import { logger } from '@superdesk/shared/logger';

/**
 * Custom domains, via the Vercel Domains API.
 *
 * The whole flow is: we add the domain to our Vercel project, Vercel hands
 * back the DNS record the admin needs to create at their own registrar, we
 * poll until DNS actually resolves through Vercel — at which point Vercel
 * has also already issued the TLS certificate, automatically, as part of
 * the same process. There's no separate "now set up SSL" step to build.
 *
 * Two different checks feed the status, not one — this was the bug in the
 * first version of this file, caught by testing against the real API rather
 * than trusting the docs: adding a domain (`POST .../domains`) returns a
 * `verified` flag that reflects *ownership* (mainly "is this domain already
 * claimed by someone else's project"), not whether DNS is actually pointed
 * here yet. A domain neither we nor anyone else has ever added comes back
 * `verified: true` immediately. Whether traffic will actually route needs a
 * second, separate call — `GET /v6/domains/{domain}/config` — whose
 * `misconfigured` field is the real signal. ACTIVE means both are true.
 *
 * `features().customDomains` gates all of this on VERCEL_API_TOKEN +
 * VERCEL_PROJECT_ID being configured — without them, requestCustomDomain
 * throws a clear "not configured" error rather than a confusing failure deep
 * in a fetch call.
 */

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const DEFAULT_CNAME_TARGET = 'cname.vercel-dns.com';
const DEFAULT_APEX_IPS = ['76.76.21.21'];

export type DomainVerificationRecord = {
  type: string;
  domain: string;
  value: string;
  reason?: string;
};

export type DnsTarget = { type: 'A'; values: string[] } | { type: 'CNAME'; value: string };

export type DomainInfo = {
  customDomain: string | null;
  status: 'PENDING' | 'VERIFYING' | 'ACTIVE' | 'FAILED';
  verifiedAt: string | null;
  lastError: string | null;
  verification: DomainVerificationRecord[];
  target: DnsTarget;
};

/**
 * Whether `domain` is a bare root domain (sugandhgoyal.xyz) rather than a
 * subdomain (help.sugandhgoyal.xyz) — the two need different DNS record
 * types. A CNAME can't legally exist at a zone's apex (RFC 1034 §3.6.2 — the
 * apex also needs NS/SOA records, and a name can't have a CNAME alongside
 * anything else); an A record pointing at Vercel's IP is the standard
 * workaround, and what registrars that don't offer ALIAS/ANAME/CNAME-
 * flattening require. This was the actual cause of a domain sitting on
 * "Verifying" indefinitely: this function didn't exist yet, so every domain
 * was shown CNAME instructions regardless — for a root domain, at most
 * registrars (GoDaddy included) there's no way to even create that record.
 *
 * Heuristic, not exact: counts labels, so it's wrong for a public-suffix
 * domain like "co.uk" (would call "example.co.uk" a 3-label subdomain when
 * it's actually a 2-label-effective apex). Fine for the common single-label
 * TLDs (.com, .xyz, .app, ...) this matters most for; a full public-suffix
 * list is the correct fix if that ever bites.
 */
function isApexDomain(domain: string): boolean {
  return domain.split('.').length === 2;
}

function vercelHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${serverEnv().VERCEL_API_TOKEN}`, 'Content-Type': 'application/json' };
}

function vercelUrl(path: string): string {
  const env = serverEnv();
  const qs = env.VERCEL_TEAM_ID ? `?teamId=${env.VERCEL_TEAM_ID}` : '';
  return `https://api.vercel.com${path}${qs}`;
}

function requireConfigured(): void {
  if (!features().customDomains) {
    throw new AppError(
      'UPSTREAM_UNAVAILABLE',
      'Custom domains are not configured on this deployment (no Vercel API token set).',
    );
  }
}

type DomainDetail = { verified?: boolean; verification?: DomainVerificationRecord[] };
type DomainConfig = {
  misconfigured?: boolean;
  recommendedCNAME?: { rank: number; value: string }[];
  recommendedIPv4?: { rank: number; value: string[] }[];
};

async function fetchDomainDetail(domain: string): Promise<DomainDetail | null> {
  const res = await fetch(vercelUrl(`/v9/projects/${serverEnv().VERCEL_PROJECT_ID}/domains/${domain}`), {
    headers: vercelHeaders(),
  });
  return res.ok ? ((await res.json()) as DomainDetail) : null;
}

async function fetchDomainConfig(domain: string): Promise<DomainConfig | null> {
  const res = await fetch(vercelUrl(`/v6/domains/${domain}/config`), { headers: vercelHeaders() });
  return res.ok ? ((await res.json()) as DomainConfig) : null;
}

/**
 * Reconciles our stored status against Vercel's two independent signals.
 * Called after adding a domain and on every explicit "check status" —
 * never assumed true just because the add call succeeded.
 */
async function syncDomainStatus(workspaceId: string, domain: string): Promise<void> {
  const [detail, config] = await Promise.all([fetchDomainDetail(domain), fetchDomainConfig(domain)]);

  if (!detail) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { customDomainStatus: 'FAILED', customDomainLastError: 'Could not reach Vercel to check this domain' },
    });
    return;
  }

  const ownershipVerified = detail.verified !== false;
  const dnsReady = config?.misconfigured === false;
  const status = !ownershipVerified || !dnsReady ? 'VERIFYING' : 'ACTIVE';

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      customDomainStatus: status,
      customDomainVerifiedAt: status === 'ACTIVE' ? new Date() : null,
      customDomainLastError: null,
    },
  });
}

export async function getDomainInfo(scope: Scope): Promise<DomainInfo> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: scope.workspaceId },
    select: {
      customDomain: true,
      customDomainStatus: true,
      customDomainVerifiedAt: true,
      customDomainLastError: true,
    },
  });

  let verification: DomainVerificationRecord[] = [];
  const apex = workspace.customDomain ? isApexDomain(workspace.customDomain) : false;
  let target: DnsTarget = apex
    ? { type: 'A', values: DEFAULT_APEX_IPS }
    : { type: 'CNAME', value: DEFAULT_CNAME_TARGET };

  if (workspace.customDomain && features().customDomains && workspace.customDomainStatus !== 'ACTIVE') {
    // Best-effort — if Vercel is unreachable, the admin still sees whatever
    // we last knew rather than an error where a status page should be.
    const [detail, config] = await Promise.all([
      fetchDomainDetail(workspace.customDomain).catch(() => null),
      fetchDomainConfig(workspace.customDomain).catch(() => null),
    ]);
    verification = detail?.verification ?? [];

    // Vercel's config response always offers both — which one is actually
    // usable depends on whether this is a root domain or a subdomain.
    if (apex && config?.recommendedIPv4?.[0]?.value.length) {
      target = { type: 'A', values: config.recommendedIPv4[0].value };
    } else if (!apex && config?.recommendedCNAME?.[0]?.value) {
      target = { type: 'CNAME', value: config.recommendedCNAME[0].value.replace(/\.$/, '') };
    }
  }

  return {
    customDomain: workspace.customDomain,
    status: workspace.customDomainStatus,
    verifiedAt: workspace.customDomainVerifiedAt?.toISOString() ?? null,
    lastError: workspace.customDomainLastError,
    verification,
    target,
  };
}

export async function requestCustomDomain(scope: Scope, rawDomain: string): Promise<DomainInfo> {
  requireConfigured();
  assertAdmin(scope);

  const domain = rawDomain.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw new AppError('BAD_REQUEST', 'Enter a valid domain, like help.yourcompany.com');
  }
  if (domain === serverEnv().KB_BASE_DOMAIN) {
    throw new AppError('BAD_REQUEST', 'That domain is already in use by this platform');
  }

  const env = serverEnv();
  const res = await fetch(vercelUrl(`/v10/projects/${env.VERCEL_PROJECT_ID}/domains`), {
    method: 'POST',
    headers: vercelHeaders(),
    body: JSON.stringify({ name: domain }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };

  if (!res.ok) {
    // Vercel returns 409 when the domain is already attached to a *different*
    // project (someone else's, or a stale attachment of our own) — a clear,
    // actionable message beats "Could not add domain" either way.
    const message =
      body.error?.code === 'domain_already_in_use'
        ? 'That domain is already connected to a different project — remove it there first.'
        : (body.error?.message ?? 'Could not add domain');
    throw new AppError('BAD_REQUEST', message);
  }

  await prisma.workspace
    .update({
      where: { id: scope.workspaceId },
      data: { customDomain: domain, customDomainStatus: 'VERIFYING', customDomainVerifiedAt: null, customDomainLastError: null },
    })
    .catch(async (err) => {
      // Unique constraint — this domain is already claimed by another
      // workspace of ours. Roll back the Vercel-side attachment so it
      // doesn't dangle on a project with no workspace pointing at it.
      await fetch(vercelUrl(`/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${domain}`), {
        method: 'DELETE',
        headers: vercelHeaders(),
      }).catch(() => {});
      throw new AppError('CONFLICT', 'That domain is already in use by another workspace', { cause: err });
    });

  // The domain might already resolve correctly (e.g. DNS was set up ahead of
  // time) — check immediately instead of making the admin wait for a
  // manual "check status" click to find out.
  await syncDomainStatus(scope.workspaceId, domain).catch((err) =>
    logger.error('Initial domain status sync failed', err, { domain }),
  );

  return getDomainInfo(scope);
}

export async function refreshDomainStatus(scope: Scope): Promise<DomainInfo> {
  requireConfigured();

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: scope.workspaceId },
    select: { customDomain: true },
  });
  if (!workspace.customDomain) throw new AppError('BAD_REQUEST', 'No custom domain is set');

  await syncDomainStatus(scope.workspaceId, workspace.customDomain);
  return getDomainInfo(scope);
}

export async function removeCustomDomain(scope: Scope): Promise<void> {
  assertAdmin(scope);

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: scope.workspaceId },
    select: { customDomain: true },
  });
  if (!workspace.customDomain) return;

  if (features().customDomains) {
    const env = serverEnv();
    await fetch(vercelUrl(`/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${workspace.customDomain}`), {
      method: 'DELETE',
      headers: vercelHeaders(),
    }).catch((err) => {
      // The workspace record is cleared either way — a stray domain left on
      // the Vercel project is a cleanup nuisance, not a correctness problem
      // (nothing routes to it once customDomain is cleared here).
      logger.error('Failed to remove domain from Vercel project', err, { domain: workspace.customDomain });
    });
  }

  await prisma.workspace.update({
    where: { id: scope.workspaceId },
    data: {
      customDomain: null,
      customDomainStatus: 'PENDING',
      customDomainVerifiedAt: null,
      customDomainLastError: null,
    },
  });
}

/** Used by middleware — no auth, just "does this hostname map to a workspace". */
export async function resolveWorkspaceByDomain(domain: string): Promise<{ slug: string } | null> {
  const workspace = await prisma.workspace.findFirst({
    where: { customDomain: domain, customDomainStatus: 'ACTIVE' },
    select: { slug: true },
  });
  return workspace;
}
