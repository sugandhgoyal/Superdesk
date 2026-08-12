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
 * Usage:
 *   DEMO_BASE_URL=http://localhost:3001 node scripts/seed-demo.mjs
 *   DEMO_BASE_URL=https://your-deployment.vercel.app node scripts/seed-demo.mjs
 *
 * Idempotent-ish: re-running against an existing demo account logs in
 * instead of failing, and reuses whatever workspace that account already
 * owns rather than creating a second one.
 */

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@superdesk.example';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Password-2026!';
const WORKSPACE_NAME = process.env.DEMO_WORKSPACE_NAME ?? 'Acme Support';

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

async function ensureDemoAccount() {
  try {
    const signup = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Demo Admin', email: EMAIL, password: PASSWORD, workspaceName: WORKSPACE_NAME },
    });
    console.log('Created demo account:', signup.workspace.slug);
    return signup.workspace.slug;
  } catch (err) {
    if (!String(err.message).includes('409') && !String(err.message).includes('400')) throw err;
    console.log('Demo account already exists — logging in instead');
    const login = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
    const me = await api('/api/auth/me');
    return me.workspaces?.[0]?.slug ?? login.workspace?.slug;
  }
}

async function seedKb(slug) {
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

async function seedConversations(slug) {
  // 1. An open conversation with a couple of exchanges.
  const c1 = await api(`/api/w/${slug}/conversations`, {
    method: 'POST',
    body: {
      contactEmail: 'jordan@example.com',
      contactName: 'Jordan Lee',
      subject: 'Billing question',
      bodyText: 'Logging this: Jordan called about being charged twice this month.',
    },
  });
  await api(`/api/w/${slug}/conversations/${c1.id}/messages`, {
    method: 'POST',
    body: { bodyText: 'Checked Stripe — confirmed a duplicate charge from a webhook retry bug.', isPrivateNote: true },
  });
  await api(`/api/w/${slug}/conversations/${c1.id}/messages`, {
    method: 'POST',
    body: { bodyText: "Hi Jordan, I've refunded the duplicate charge — it'll post in 3-5 business days." },
  });

  // 2. A resolved conversation.
  const c2 = await api(`/api/w/${slug}/conversations`, {
    method: 'POST',
    body: {
      contactEmail: 'sam@example.com',
      contactName: 'Sam Rivera',
      subject: 'Feature request',
      bodyText: 'Sam emailed asking whether we support SSO — logging their request for the roadmap.',
    },
  });
  await api(`/api/w/${slug}/conversations/${c2.id}/resolve`, { method: 'POST', body: {} });

  // 3. A snoozed conversation.
  const c3 = await api(`/api/w/${slug}/conversations`, {
    method: 'POST',
    body: {
      contactEmail: 'taylor@example.com',
      contactName: 'Taylor Kim',
      subject: 'Waiting on engineering',
      bodyText: "Taylor's issue is filed as a bug — snoozing until the fix ships.",
    },
  });
  const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await api(`/api/w/${slug}/conversations/${c3.id}/snooze`, { method: 'POST', body: { until } });

  console.log('Seeded 3 conversations: open, resolved, snoozed');
  return c1.id;
}

async function main() {
  console.log(`Seeding demo data against ${BASE_URL}`);
  const slug = await ensureDemoAccount();
  await seedKb(slug);
  const firstConversationId = await seedConversations(slug);

  console.log('\nDone.');
  console.log(`  Login:      ${EMAIL} / ${PASSWORD}`);
  console.log(`  Inbox:      ${BASE_URL}/w/${slug}/inbox`);
  console.log(`  Help center: ${BASE_URL}/help/${slug}`);
  console.log(`  Widget demo: ${BASE_URL}/demo?ws=${slug}`);
  console.log(`  Try the AI summary on: ${BASE_URL}/w/${slug}/inbox (open the first conversation, id ${firstConversationId})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
