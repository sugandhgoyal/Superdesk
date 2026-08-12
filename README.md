# SuperDesk

A unified customer-communication platform — live chat, email, and a
searchable help center feeding one inbox, with AI summaries and per-workspace
custom domains. Built as a 48-hour take-home; this README doubles as the
submission write-up.

**Live:** https://superdesk-one.vercel.app
**Repo:** https://github.com/sugandhgoyal/Superdesk

## Try it now

```
Email:    demo@superdesk.example
Password: Demo-Password-2026!
```

That account has a seeded workspace (`acme-support`) with a few
conversations in different states, two published help-center articles, and
the AI summary panel ready to try. Or sign up fresh at `/signup` — every
feature below works the same either way.

- **Inbox:** https://superdesk-one.vercel.app/w/acme-support/inbox
- **Help center:** https://superdesk-one.vercel.app/help/acme-support
- **Chat widget, embedded on a stand-in customer site:**
  https://superdesk-one.vercel.app/demo?ws=acme-support

To re-seed (idempotent — logs into the existing account instead of failing):

```bash
DEMO_BASE_URL=https://superdesk-one.vercel.app node scripts/seed-demo.mjs
```

## The 7 requirements, and where they live

| # | Requirement | Code | Notes |
|---|---|---|---|
| 1 | Auth, team management, RBAC | `apps/web/src/lib/auth/`, `lib/members.ts`, `lib/invites.ts` | Argon2id, DB-backed session revocation, invite tokens hashed at rest, ADMIN/AGENT roles |
| 2 | Embeddable live chat widget, real-time | `public/widget.js`, `app/widget/[slug]`, `lib/widget/`, `lib/sse.ts` | Server-Sent Events, not WebSocket — see [Realtime](#realtime-sse-not-websocket) below |
| 3 | Email channel, inbound parsing, threading | `lib/email/inbound.ts`, `lib/email/outbound.ts`, `app/api/webhooks/email/inbound` | Message-ID/In-Reply-To/References, with a subject+contact fallback thread key |
| 4 | Unified inbox — filter/assign/snooze/resolve | `lib/conversations.ts`, `components/inbox/` | Full audit trail as in-thread system messages |
| 5 | Knowledge base, public search, in-widget suggestions | `lib/kb.ts`, `app/help/[slug]`, `components/kb-admin/` | Markdown authoring, sanitized on save |
| 6 | AI conversation summarization | `lib/ai/summarize.ts` | Incremental (only the delta since the last summary), with a non-AI fallback |
| 7 | Custom domains with SSL | `lib/domains.ts`, `middleware.ts` | Vercel Domains API; SSL is automatic, not a separate step |

## Architecture

Single Next.js 15 app (App Router, TypeScript), Postgres (Neon), deployed to
Vercel. No separate services to stand up — deliberately: every piece of
"backend" here is a route handler in the same deployable as the frontend.

```
apps/web/                  the whole application
  src/app/                 pages + API routes (Next.js App Router)
    (auth)/                 login, signup, invite acceptance
    w/[slug]/                the dashboard — inbox, KB admin, domain settings
    help/[slug]/              public knowledge base
    widget/[slug]/             the chat widget's own page (served in an iframe)
    demo/                       a stand-in "customer site" for trying the widget
    api/                     everything above talks to these
  src/lib/                 business logic, one module per concern
  src/components/          UI, grouped by feature
packages/db/                Prisma schema + generated client, shared by the app
packages/shared/             env validation, error types, logging
scripts/seed-demo.mjs        demo data, via the real HTTP API
```

### Realtime: SSE, not WebSocket

The schema and `.env.example` still carry `REDIS_URL` and
`GATEWAY_INTERNAL_SECRET` — the original design reserved room for a
standalone Socket.IO gateway process, a genuinely different architecture
from what's actually running. That would need to be hosted somewhere with a
persistent process (Vercel serverless functions can't hold one), which means
a second deployable, a second set of credentials, a second thing to keep
running. Mid-build, that tradeoff was surfaced explicitly rather than
assumed away, and the simpler path was chosen deliberately: one deployable,
Server-Sent Events instead of WebSocket.

How it actually works (`apps/web/src/lib/sse.ts`): a client connects to a
streaming endpoint, which polls Postgres for anything newer than the
client's last-seen message `seq` every ~1.5s, and self-closes at 8s — safely
inside Vercel's function-duration ceiling. `EventSource` reconnects on its
own when a connection ends, and resumption rides `Last-Event-ID` (not a
static query param), so a reconnect never redelivers what the client
already has. In practice this is indistinguishable from push: sub-2-second
latency, no client-side reconnect logic to write, and it uses no
infrastructure beyond what's already deployed.

### Multi-tenancy

Every query is scoped by `workspaceId`, enforced through helpers in
`packages/db/src/tenant.ts` rather than trusted to each call site — the
`Scope` type makes forgetting the scope a compile error, not a data leak.
Cross-tenant access (a valid id from the wrong workspace) 404s; an
in-tenant permission failure (an AGENT trying an ADMIN-only action) 403s
with an actual message. Postgres RLS was considered as a second layer and
explicitly not built — it needs a per-transaction `SET LOCAL` that fights
Neon's connection pooler — documented as a known limitation rather than
half-implemented.

### A few decisions worth flagging

- **Search** (KB and, indirectly, AI context) is Postgres `ILIKE` with
  in-memory relevance scoring, not `tsvector`/full-text search. The schema
  comments this size of dataset in mind; a real search extension is the
  obvious next step past take-home scale.
- **Inbound email sanitization** (`lib/sanitize-html.ts`) is an allowlist
  sanitizer (the `sanitize-html` package), not `dangerouslySetInnerHTML`
  with a prayer. It strips `<script>`, inline `style=`, `on*` handlers, and
  `javascript:` URLs — verified against a real payload during testing, not
  just assumed correct.
- **AI summaries are incremental.** `ConversationSummary.upToSeq` bookmarks
  how far the model has already read; a refresh only sends the messages
  since then plus the prior summary's own text. Cost stays flat as a thread
  grows instead of scaling with it.
- **The AI summary never fails visibly.** No API key, a hit rate limit, or
  an API error all fall back to a pattern-matched extractive summary
  (`degraded: true`, shown as a badge) instead of an error state.
- **Structured AI output** comes from a forced `tool_choice` (one tool,
  pinned), not "please return JSON" in a prompt — the model can't return
  anything shaped differently, and it's re-validated with `zod` regardless.
- **Custom domain status** checks two independent Vercel signals, not one.
  This was a real bug caught by testing against the live Vercel API instead
  of trusting the docs: the add-domain call's `verified` flag reflects
  *ownership*, not DNS readiness — a domain with no DNS record pointed at
  Vercel at all came back `verified: true`. Status is now ACTIVE only when
  a second call (`GET /v6/domains/{domain}/config`, whose `misconfigured`
  field is the real signal) also confirms it.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL/DIRECT_URL at minimum
npm run db:push
npm run dev             # http://localhost:3001
```

Everything else in `.env.example` is optional — the app degrades
gracefully without it:

- No `ANTHROPIC_API_KEY` → AI summaries use the extractive fallback.
- `EMAIL_PROVIDER=console` (the default) → outbound "sends" just log.
- No `VERCEL_API_TOKEN` → custom domains render in explain-only mode.
- No Upstash REST credentials → rate limiting runs in-process instead of
  shared across instances (fine for local dev, noted as a limitation in
  production).

## Security notes

- Passwords: Argon2id at OWASP baseline params.
- Sessions: JWT for a fast signature check on every request, backed by a
  DB row for real revocation — a stolen token doesn't survive a "sign out
  everywhere."
- Invite tokens are SHA-256 hashed at rest; the raw token exists only in
  the one-time URL.
- Joining a workspace via invite for an email that already has an account
  requires that account's password — the account-takeover path (an invite
  silently handing control of an existing email's account to whoever
  clicked the link) was caught and fixed during testing.
- The widget authenticates with a signed, scoped JWT instead of a cookie
  (it runs in a cross-site iframe, where third-party cookies aren't
  reliable) — blast radius of a leaked token is one visitor's own
  conversation, not an account.
- Private notes are filtered out of every customer-facing surface — the
  widget's initial load, its live stream, and outbound email all exclude
  them explicitly, not by relying on a single shared code path to remember.
- The custom-domains feature reuses the same Vercel token already used for
  deployment throughout this build, per an explicit choice made along the
  way — Vercel tokens aren't resource-scopable, so this is the same
  account-wide access either way; the alternative (a separate token) would
  only have bought independent revocation, not a smaller blast radius.

## Known limitations

- **Search** is `ILIKE`, not full-text search — fine at this scale, would
  need a real search extension or service past it.
- **Realtime** is polling-based SSE, not a WebSocket subscription — see
  above. Functionally equivalent at this scale (sub-2s latency); the
  difference would matter at a traffic level this build was never going to
  be tested at.
- **No queue-backed worker** — inbound email and AI summarization run
  synchronously in the request that triggers them. `REDIS_URL` is wired up
  for exactly this if it were needed.
- **RLS is not implemented** — tenant isolation is enforced in the
  application layer only (see [Multi-tenancy](#multi-tenancy)).
