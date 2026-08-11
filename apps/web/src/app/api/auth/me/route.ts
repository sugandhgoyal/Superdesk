import { defineRoute } from '@/lib/api/route';
import { listWorkspacesForUser } from '@/lib/workspace';

export const runtime = 'nodejs';

/** Bootstrap call the dashboard makes on load to hydrate the session. */
export const GET = defineRoute({
  handler: async ({ user }) => {
    const workspaces = await listWorkspacesForUser(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      workspaces,
    };
  },
});
