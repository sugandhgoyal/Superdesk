import { prisma } from '@superdesk/db';

/**
 * Workspace identifiers.
 *
 * Two distinct handles per workspace:
 *   - `slug`         → the KB subdomain, user-visible, renameable later
 *   - `inboundAlias` → the local part of the support address
 *
 * They're separate on purpose. Renaming a workspace shouldn't silently
 * redirect a support address that customers already have in their sent
 * folders and that live email threads are keyed against.
 */

const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'help',
  'support',
  'www',
  'mail',
  'inbound',
  'dashboard',
  'status',
  'blog',
  'docs',
  'login',
  'signup',
  'settings',
  'widget',
  'static',
  'assets',
]);

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return base || 'workspace';
}

function randomSuffix(length = 5): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Finds a free slug/alias pair.
 *
 * Tries the clean name first, then appends increasingly random suffixes. The
 * unique constraints in Postgres are still the real arbiter — this only
 * reduces how often we hit them.
 */
async function allocateIdentifiers(
  workspaceName: string,
): Promise<{ slug: string; inboundAlias: string }> {
  const base = slugify(workspaceName);

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate =
      attempt === 0 && !RESERVED.has(base)
        ? base
        : `${base}-${randomSuffix(attempt < 3 ? 4 : 8)}`;

    const clash = await prisma.workspace.findFirst({
      where: {
        OR: [{ slug: candidate }, { inboundAlias: candidate }],
      },
      select: { id: true },
    });

    if (!clash) return { slug: candidate, inboundAlias: candidate };
  }

  // Astronomically unlikely; better than looping forever.
  const fallback = `${base}-${randomSuffix(12)}`;
  return { slug: fallback, inboundAlias: fallback };
}

export type CreatedWorkspace = {
  id: string;
  name: string;
  slug: string;
  inboundAlias: string;
};

/**
 * Creates a workspace and makes the given user its first admin.
 *
 * Single transaction: a workspace with no members would be unreachable —
 * nobody could sign in to it, and nothing could delete it either.
 */
export async function createWorkspaceWithOwner(
  userId: string,
  workspaceName: string,
): Promise<CreatedWorkspace> {
  const { slug, inboundAlias } = await allocateIdentifiers(workspaceName);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        slug,
        inboundAlias,
        kbTitle: `${workspaceName} Help Center`,
      },
      select: { id: true, name: true, slug: true, inboundAlias: true },
    });

    await tx.membership.create({
      data: { workspaceId: workspace.id, userId, role: 'ADMIN' },
    });

    return workspace;
  });
}

/** The support address customers write to for this workspace. */
export function supportAddress(inboundAlias: string, domain: string): string {
  return `${inboundAlias}@${domain}`;
}

export async function listWorkspacesForUser(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, slug: true, inboundAlias: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}
