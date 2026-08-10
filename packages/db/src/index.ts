import { PrismaClient } from '../generated/client';

export * from '../generated/client';

/**
 * Single Prisma instance per process.
 *
 * Next.js dev reloads modules on every edit; without the global cache each
 * reload opens a fresh connection pool and Postgres runs out of slots within a
 * few minutes. The gateway and worker are long-lived and just get the one.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
