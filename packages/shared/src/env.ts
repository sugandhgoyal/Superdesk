import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once, lazily, at first access — a missing DATABASE_URL should crash
 * the process on boot with a readable message, not surface as a confusing
 * connection error on the first customer request.
 *
 * Split by surface because each deployable needs a different subset: Vercel
 * doesn't need GATEWAY_PORT, the worker doesn't need VERCEL_API_TOKEN.
 */

const nonEmpty = z.string().min(1);
const secret = z.string().min(16, 'secrets must be at least 16 characters');

/**
 * An unconfigured integration.
 *
 * `.env` files can't express "absent" — a key someone hasn't filled in yet is
 * an empty string, not undefined. Treating "" as undefined is what lets the
 * feature gates below work: an empty ANTHROPIC_API_KEY disables the AI panel
 * instead of crashing the whole app at boot.
 */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const coreSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: nonEmpty,
  DIRECT_URL: optionalString,
  // TCP Redis. Originally reserved for a standalone Socket.IO gateway
  // process; realtime chat instead ships as Server-Sent Events served
  // directly from the Next.js app (see apps/web/src/app/api/widget/stream and
  // .../conversations/[id]/stream) so the whole product stays on one
  // deployable with no long-lived process to host separately. Kept — and
  // still required — for a future queue-backed worker (inbound email
  // processing, scheduled digests) that genuinely needs a persistent
  // connection a serverless function can't hold.
  REDIS_URL: nonEmpty,
  // HTTP Redis — used by serverless request handlers for rate limiting. A
  // TCP pool per lambda invocation exhausts Upstash's connection limit under
  // any real traffic; the REST client is stateless and doesn't.
  UPSTASH_REDIS_REST_URL: optionalString,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  AUTH_SECRET: secret,
  WIDGET_TOKEN_SECRET: secret,
  GATEWAY_INTERNAL_SECRET: secret,
  APP_URL: z.string().url(),
  KB_BASE_DOMAIN: nonEmpty.default('localhost:3000'),
});

const aiSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_SUMMARY_HOURLY_LIMIT: z.coerce.number().int().positive().default(60),
});

const emailSchema = z.object({
  EMAIL_PROVIDER: z.enum(['resend', 'mailgun', 'console']).default('console'),
  RESEND_API_KEY: optionalString,
  MAILGUN_API_KEY: optionalString,
  MAILGUN_SIGNING_KEY: optionalString,
  OUTBOUND_EMAIL_DOMAIN: z.string().default('localhost'),
  INBOUND_EMAIL_DOMAIN: z.string().default('localhost'),
  INBOUND_WEBHOOK_SECRET: optionalString,
});

const domainsSchema = z.object({
  VERCEL_API_TOKEN: optionalString,
  VERCEL_PROJECT_ID: optionalString,
  VERCEL_TEAM_ID: optionalString,
});

const serverSchema = coreSchema
  .extend(aiSchema.shape)
  .extend(emailSchema.shape)
  .extend(domainsSchema.shape);

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * Feature gates derived from config rather than hardcoded.
 *
 * The product degrades to a usable state when an optional integration is
 * unconfigured: no Anthropic key means the summary panel hides itself instead
 * of throwing, no Vercel token means custom domains stay in explain-only mode.
 */
export function features() {
  const env = serverEnv();
  return {
    ai: Boolean(env.ANTHROPIC_API_KEY),
    outboundEmail: env.EMAIL_PROVIDER !== 'console',
    customDomains: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID),
  };
}
