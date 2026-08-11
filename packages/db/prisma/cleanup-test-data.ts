import { prisma } from '../src/index';

/**
 * Removes accounts created while smoke-testing against the live database.
 * Kept in the repo because this will need running again after each manual
 * test pass on production.
 */
const TEST_EMAILS = ['sugandh@acme.test', 'outsider@other.test'];
const TEST_SLUGS = ['acme-inc', 'other-co'];

async function main() {
  const users = await prisma.user.deleteMany({
    where: { email: { in: TEST_EMAILS } },
  });
  // Workspaces don't cascade from users — a workspace outlives any single
  // member — so they're removed explicitly.
  const workspaces = await prisma.workspace.deleteMany({
    where: { slug: { in: TEST_SLUGS } },
  });

  console.log(
    JSON.stringify({
      usersDeleted: users.count,
      workspacesDeleted: workspaces.count,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
