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
 * poll Vercel's verification endpoint until it reports the domain verified —
 * at which point Vercel has also already issued the TLS certificate,
 * automatically, as part of the same process. There's no separate "now set
 * up SSL" step to build; that's the point of using Vercel's own domain
 * management instead of hand-rolling ACME.
 *
 * `features().customDomains` gates all of this on VERCEL_API_TOKEN +
 * VERCEL_PROJECT_ID being configured — without them, requestCustomDomain
 * throws a clear "not configured" error rather than a confusing failure deep
 * in a fetch call.
 */

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export type DomainVerificationRecord = {
  type: string;
  domain: string;
  value: string;
  reason?: string;
};

export type DomainInfo = {
  customDomain: string | null;
  status: 'PENDING' | 'VERIFYING' | 'ACTIVE' | 'FAILED';
  verifiedAt: string | null;
  lastError: string | null;
  verification: DomainVerificationRecord[];
  /** The record to point at Vercel — shown regardless of verification state, since it's needed either way. */
  target: { type: 'CNAME'; value: string };
};

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
  if (workspace.customDomain && features().customDomains && workspace.customDomainStatus !== 'ACTIVE') {
    // Best-effort — if Vercel is unreachable, the admin still sees whatever
    // we last knew rather than an error where a status page should be.
    verification = await fetchVerificationRecords(workspace.customDomain).catch(() => []);
  }

  return {
    customDomain: workspace.customDomain,
    status: workspace.customDomainStatus,
    verifiedAt: workspace.customDomainVerifiedAt?.toISOString() ?? null,
    lastError: workspace.customDomainLastError,
    verification,
    target: { type: 'CNAME', value: 'cname.vercel-dns.com' },
  };
}

async function fetchVerificationRecords(domain: string): Promise<DomainVerificationRecord[]> {
  const res = await fetch(vercelUrl(`/v9/projects/${serverEnv().VERCEL_PROJECT_ID}/domains/${domain}`), {
    headers: vercelHeaders(),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { verification?: DomainVerificationRecord[] };
  return body.verification ?? [];
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

  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
    verified?: boolean;
    verification?: DomainVerificationRecord[];
  };

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
      data: {
        customDomain: domain,
        customDomainStatus: body.verified ? 'ACTIVE' : 'VERIFYING',
        customDomainVerifiedAt: body.verified ? new Date() : null,
        customDomainLastError: null,
      },
    })
    .catch(async (err) => {
      // Unique constraint — this domain is already claimed by another
      // workspace of ours. Roll back the Vercel-side attachment so it
      // doesn't dangle on a project with no workspace pointing at it.
      await fetch(vercelUrl(`/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${domain}`), {
        method: 'DELETE',
        headers: vercelHeaders(),
      }).catch(() => {});
      throw new AppError('CONFLICT', 'That domain is already in use by another workspace', {
        cause: err,
      });
    });

  return getDomainInfo(scope);
}

export async function refreshDomainStatus(scope: Scope): Promise<DomainInfo> {
  requireConfigured();

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: scope.workspaceId },
    select: { customDomain: true },
  });
  if (!workspace.customDomain) throw new AppError('BAD_REQUEST', 'No custom domain is set');

  const env = serverEnv();
  const res = await fetch(
    vercelUrl(`/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${workspace.customDomain}/verify`),
    { method: 'POST', headers: vercelHeaders(), signal: AbortSignal.timeout(15_000) },
  );
  const body = (await res.json().catch(() => ({}))) as {
    verified?: boolean;
    error?: { message?: string };
  };

  if (!res.ok) {
    await prisma.workspace.update({
      where: { id: scope.workspaceId },
      data: { customDomainStatus: 'FAILED', customDomainLastError: body.error?.message ?? 'Verification failed' },
    });
    logger.warn('Domain verification check failed', { domain: workspace.customDomain, body });
    return getDomainInfo(scope);
  }

  await prisma.workspace.update({
    where: { id: scope.workspaceId },
    data: {
      customDomainStatus: body.verified ? 'ACTIVE' : 'VERIFYING',
      customDomainVerifiedAt: body.verified ? new Date() : null,
      customDomainLastError: null,
    },
  });

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
