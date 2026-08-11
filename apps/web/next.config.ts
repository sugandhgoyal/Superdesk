import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source rather than build output, so
  // Next compiles them alongside the app. One less build step to keep in sync.
  transpilePackages: ['@superdesk/db', '@superdesk/shared'],

  // Native/binary dependencies must stay external — bundling them breaks the
  // engine resolution in Prisma and the .node binary in argon2.
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2'],

  // We're inside an npm workspace; without this Next traces files from
  // apps/web and misses the hoisted node_modules at the repo root.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  async headers() {
    return [
      {
        // Baseline hardening for every dashboard route. The widget embed and
        // public KB get their own relaxed policies where they're served.
        source: '/((?!widget|embed).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
