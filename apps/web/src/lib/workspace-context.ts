import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@superdesk/db';
import type { Scope } from '@superdesk/db/tenant';
import { getCurrentUser, type AuthedUser } from '@/lib/auth/session';

export type WorkspaceContext = {
  user: AuthedUser;
  scope: Scope;
  workspace: {
    id: string;
    name: string;
    slug: string;
    inboundAlias: string;
    customDomain: string | null;
  };
};

/**
 * Resolves a workspace from its URL slug and proves the signed-in user belongs
 * to it, in one query.
 *
 * Every server component under /w/[slug] calls this — the layout for the top
 * nav, and every page again for its own scope. Wrapped in `cache()` for the
 * same reason as `getCurrentUser`: without it, one navigation was paying for
 * this membership lookup (plus the session lookup inside `getCurrentUser`)
 * twice, which was the actual cause of a multi-second delay switching tabs —
 * four sequential round trips to Postgres before the page's own data even
 * started loading. `cache()` collapses the layout's call and the page's call
 * into one, per request; a fresh request still always re-checks for real.
 *
 * A user who isn't a member gets a 404 rather than a 403 — a 403 would
 * confirm the workspace exists, which is enough to enumerate customers.
 */
export const requireWorkspace = cache(async (
  slug: string,
): Promise<WorkspaceContext> => {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/w/${slug}/inbox`)}`);
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      workspace: { slug },
    },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          inboundAlias: true,
          customDomain: true,
        },
      },
    },
  });

  if (!membership) notFound();

  return {
    user,
    scope: {
      workspaceId: membership.workspace.id,
      userId: user.id,
      role: membership.role,
    },
    workspace: membership.workspace,
  };
});
