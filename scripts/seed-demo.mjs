#!/usr/bin/env node
/**
 * Populates a demo workspace with realistic sample data — a KB with a
 * couple of published articles, and a handful of conversations across
 * channels and statuses — by driving the real HTTP API, the same way any
 * client of this app does.
 *
 * Deliberately not a Prisma script: everything it creates already has a
 * documented, validated path through the app (signup, KB CRUD, conversation
 * actions, the inbound email webhook), so seeding this way exercises those
 * same code paths instead of writing rows that bypass them. It also sidesteps
 * needing this script to duplicate Argon2 password hashing outside the app
 * package that owns it.
 *
 * The sample conversations open with a *simulated inbound email* (via the
 * real webhook, not a shortcut) rather than an agent-authored opening
 * message — that's what actually exercises Req 3 (inbound parsing +
 * threading), and it's what makes the seeded conversations read as real
 * two-sided exchanges instead of an agent talking to themselves.
 *
 * Usage:
 *   DEMO_BASE_URL=http://localhost:3001 DEMO_INBOUND_SECRET=... node scripts/seed-demo.mjs
 *   DEMO_BASE_URL=https://your-deployment.vercel.app DEMO_INBOUND_SECRET=... node scripts/seed-demo.mjs
 *
 * DEMO_INBOUND_SECRET must match the deployment's INBOUND_WEBHOOK_SECRET.
 *
 * Idempotent-ish: re-running against an existing demo account logs in
 * instead of failing, and reuses whatever workspace that account already
 * owns rather than creating a second one. Re-running also re-simulates the
 * inbound emails; thanks to the app's own thread-matching (subject +
 * contact), they land back in the same conversations rather than
 * duplicating them.
 */

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@superdesk.example';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Password-2026!';
const WORKSPACE_NAME = process.env.DEMO_WORKSPACE_NAME ?? 'Acme Support';
const INBOUND_SECRET = process.env.DEMO_INBOUND_SECRET ?? '';
const INBOUND_DOMAIN = process.env.DEMO_INBOUND_DOMAIN ?? 'sugandhgoyal.xyz';

let cookie = '';

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: BASE_URL,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/** Simulates a customer's inbound email arriving, via the real webhook. */
async function simulateInboundEmail({ inboundAlias, from, fromName, subject, text }) {
  if (!INBOUND_SECRET) {
    throw new Error(
      'DEMO_INBOUND_SECRET is required — it must match this deployment\'s INBOUND_WEBHOOK_SECRET env var.',
    );
  }
  const result = await fetch(
    `${BASE_URL}/api/webhooks/email/inbound?secret=${encodeURIComponent(INBOUND_SECRET)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerMessageId: `seed-${crypto.randomUUID()}`,
        from,
        fromName,
        to: `${inboundAlias}@${INBOUND_DOMAIN}`,
        subject,
        text,
        messageId: `<seed-${crypto.randomUUID()}@${from.split('@')[1]}>`,
      }),
    },
  );
  const json = await result.json();
  if (!result.ok || json.status === 'rejected') {
    throw new Error(`Inbound simulation failed: ${JSON.stringify(json)}`);
  }
  return json; // { status, conversationId }
}

async function ensureDemoAccount() {
  try {
    const signup = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Demo Admin', email: EMAIL, password: PASSWORD, workspaceName: WORKSPACE_NAME },
    });
    console.log('Created demo account:', signup.workspace.slug);
    return { slug: signup.workspace.slug, inboundAlias: signup.workspace.inboundAlias };
  } catch (err) {
    if (!String(err.message).includes('409') && !String(err.message).includes('400')) throw err;
    console.log('Demo account already exists — logging in instead');
    await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
    const me = await api('/api/auth/me');
    const ws = me.workspaces?.[0];
    return { slug: ws?.slug, inboundAlias: ws?.inboundAlias };
  }
}

async function seedKb(slug) {
  const existing = await api(`/api/w/${slug}/kb/sections`);
  const already = existing.sections.find((s) => s.name === 'Getting Started');
  if (already) {
    console.log('KB already seeded — skipping (re-run would otherwise duplicate it)');
    return;
  }

  const section = await api(`/api/w/${slug}/kb/sections`, {
    method: 'POST',
    body: { name: 'Getting Started', description: 'The basics for new customers.' },
  });

  const articles = [
    {
      title: 'How to reset your password',
      markdown:
        '# Resetting your password\n\nGo to the **login page** and click *Forgot password*.\n\n- Enter the email on your account\n- Check your inbox for a reset link\n- The link expires in 1 hour\n\nIf you don\'t see the email, check spam before contacting us.',
    },
    {
      title: 'Understanding your billing cycle',
      markdown:
        '# Billing cycles\n\nYou\'re billed monthly on the date you signed up. Changes to your plan take effect **immediately**, and we prorate the difference on your next invoice.\n\n```\nExample: upgrading mid-cycle charges only the remaining days at the new rate.\n```',
    },
  ];

  for (const article of articles) {
    const created = await api(`/api/w/${slug}/kb/articles`, {
      method: 'POST',
      body: { ...article, sectionId: section.id },
    });
    await api(`/api/w/${slug}/kb/articles/${created.id}`, {
      method: 'PATCH',
      body: { status: 'PUBLISHED' },
    });
  }
  console.log('Seeded KB: 1 section, 2 published articles');
}

async function seedConversations(slug, inboundAlias) {
  // 1. An open conversation — customer emails in, agent leaves a private
  //    note, agent replies. All three roles visible, correctly labeled.
  const inbound1 = await simulateInboundEmail({
    inboundAlias,
    from: 'jordan@example.com',
    fromName: 'Jordan Lee',
    subject: 'Billing question',
    text: "Hi, I think I was charged twice for my subscription this month — can you take a look?",
  });
  const c1 = inbound1.conversationId;
  await api(`/api/w/${slug}/conversations/${c1}/messages`, {
    method: 'POST',
    body: { bodyText: 'Checked Stripe — confirmed a duplicate charge from a webhook retry bug.', isPrivateNote: true },
  });
  await api(`/api/w/${slug}/conversations/${c1}/messages`, {
    method: 'POST',
    body: { bodyText: "Hi Jordan, I've refunded the duplicate charge — it'll post in 3-5 business days." },
  });

  // 2. A resolved conversation.
  const inbound2 = await simulateInboundEmail({
    inboundAlias,
    from: 'sam@example.com',
    fromName: 'Sam Rivera',
    subject: 'Feature request',
    text: 'Does your product support SSO (single sign-on)? Wondering if that\'s on the roadmap.',
  });
  const c2 = inbound2.conversationId;
  await api(`/api/w/${slug}/conversations/${c2}/messages`, {
    method: 'POST',
    body: { bodyText: "Thanks for asking! SSO isn't available yet, but I've logged this as a feature request for our roadmap." },
  });
  await api(`/api/w/${slug}/conversations/${c2}/resolve`, { method: 'POST', body: {} });

  // 3. A snoozed conversation.
  const inbound3 = await simulateInboundEmail({
    inboundAlias,
    from: 'taylor@example.com',
    fromName: 'Taylor Kim',
    subject: 'Export button not working',
    text: 'The "Export to CSV" button on my dashboard just spins forever and never downloads anything.',
  });
  const c3 = inbound3.conversationId;
  await api(`/api/w/${slug}/conversations/${c3}/messages`, {
    method: 'POST',
    body: { bodyText: "Thanks for the report — I've filed this as a bug with engineering. Snoozing until it ships so I don't lose track of it.", isPrivateNote: true },
  });
  const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await api(`/api/w/${slug}/conversations/${c3}/snooze`, { method: 'POST', body: { until } });

  console.log('Seeded 3 conversations (each opened by a real simulated inbound email): open, resolved, snoozed');
  return c1;
}

/**
 * A longer, multi-turn conversation specifically to demo AI summarization
 * against something with actual substance — a one-liner doesn't show what
 * the feature is for. Ends by calling the real summarize endpoint (an
 * actual Claude call, not a canned example) so a summary already exists
 * when someone opens it, rather than an empty "Generate" prompt.
 */
async function seedLongConversation(slug, inboundAlias) {
  const inbound = await simulateInboundEmail({
    inboundAlias,
    from: 'morgan@example.com',
    fromName: 'Morgan Blake',
    subject: 'Data migration stuck',
    text: "Hi, we just upgraded to the Team plan and I'm trying to migrate our workspace data from the old account, but the import has been stuck at \"Processing\" for over an hour. Can you help?",
  });
  const id = inbound.conversationId;

  const turns = [
    {
      isPrivateNote: true,
      bodyText:
        "Checked the backend — the import job is stuck in queue, looks like it's waiting on a stale lock from a previous failed attempt.",
    },
    {
      bodyText:
        "Hi Morgan, thanks for reaching out — sorry about the delay. I can see the import job is stuck. Could you tell me roughly how many contacts/records you're migrating? That'll help me figure out if this is a size issue or something else.",
    },
    {
      inbound: true,
      text: "Sure — around 4,200 contacts and about 900 past conversations. We tried starting the import twice, both times it got stuck around the same point.",
    },
    {
      isPrivateNote: true,
      bodyText:
        '4,200 contacts matches a known issue: the bulk importer times out silently on large batches without chunking. Restarting with the manual chunked import instead.',
    },
    {
      bodyText:
        "Found it — with a dataset that size, the automatic importer can time out silently. I've manually restarted your migration in smaller batches on our end, which should avoid that. It'll take about 20-30 minutes to fully complete this time — I'll update you as soon as it's done.",
    },
    {
      inbound: true,
      text: "Okay, appreciate it. One more thing — will our existing team's role assignments (who's admin vs agent) carry over, or do we need to re-set those after the import finishes?",
    },
    {
      bodyText:
        "Good question — role assignments do carry over automatically as part of the import, so you shouldn't need to redo them. I'll confirm that specifically once the migration finishes and let you know either way.",
    },
    {
      inbound: true,
      text: 'The import finished and everything looks right, including the roles. Thanks so much for sorting this out quickly!',
    },
    {
      bodyText: "Fantastic, glad it's all sorted! Let us know if anything looks off as your team starts using it. Have a great day!",
    },
  ];

  for (const turn of turns) {
    if (turn.inbound) {
      await simulateInboundEmail({
        inboundAlias,
        from: 'morgan@example.com',
        fromName: 'Morgan Blake',
        subject: 'Re: Data migration stuck',
        text: turn.text,
      });
    } else {
      await api(`/api/w/${slug}/conversations/${id}/messages`, {
        method: 'POST',
        body: { bodyText: turn.bodyText, isPrivateNote: turn.isPrivateNote ?? false },
      });
    }
  }

  await api(`/api/w/${slug}/conversations/${id}/resolve`, { method: 'POST', body: {} });

  console.log('Seeded 1 long conversation (9 turns, resolved) — generating its AI summary now…');
  const summary = await api(`/api/w/${slug}/conversations/${id}/summarize`, { method: 'POST', body: {} });
  console.log(summary.degraded ? '  (AI unavailable — used the extractive fallback)' : '  Summary generated.');

  return id;
}

async function main() {
  console.log(`Seeding demo data against ${BASE_URL}`);
  const { slug, inboundAlias } = await ensureDemoAccount();
  await seedKb(slug);
  const firstConversationId = await seedConversations(slug, inboundAlias);
  const longConversationId = await seedLongConversation(slug, inboundAlias);

  console.log('\nDone.');
  console.log(`  Login:      ${EMAIL} / ${PASSWORD}`);
  console.log(`  Inbox:      ${BASE_URL}/w/${slug}/inbox`);
  console.log(`  Help center: ${BASE_URL}/help/${slug}`);
  console.log(`  Widget demo: ${BASE_URL}/demo?ws=${slug}`);
  console.log(`  Try the AI summary on: ${BASE_URL}/w/${slug}/inbox (open the first conversation, id ${firstConversationId})`);
  console.log(`  Already-summarized long conversation: ${BASE_URL}/w/${slug}/inbox (id ${longConversationId}, under Resolved)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
