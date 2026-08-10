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

const coreSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: nonEmpty,
  DIRECT_URL: nonEmpty.optional(),
  REDIS_URL: nonEmpty,
  AUTH_SECRET: secret,
  WIDGET_TOKEN_SECRET: secret,
  GATEWAY_INTERNAL_SECRET: secret,
  APP_URL: z.string().url(),
  KB_BASE_DOMAIN: nonEmpty.default('localhost:3000'),
});

const aiSchema = z.object({
  ANTHROPIC_API_KEY: nonEmpty.optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_SUMMARY_HOURLY_LIMIT: z.coerce.number().int().positive().default(60),
});

const emailSchema = z.object({
  EMAIL_PROVIDER: z.enum(['resend', 'mailgun', 'console']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_SIGNING_KEY: z.string().optional(),
  OUTBOUND_EMAIL_DOMAIN: z.string().default('localhost'),
  INBOUND_EMAIL_DOMAIN: z.string().default('localhost'),
  INBOUND_WEBHOOK_SECRET: z.string().optional(),
});

const domainsSchema = z.object({
  VERCEL_API_TOKEN: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
});

const serverSchema = coreSchema
  .merge(aiSchema)
  .merge(emailSchema)
  .merge(domainsSchema);

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
