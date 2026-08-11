'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

type LoginResponse = {
  workspaces: Array<{ slug: string }>;
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        },
      });

      // Honour the page the user was trying to reach before being bounced to
      // login, but only if it's a relative path — an open redirect here would
      // let a phishing link bounce through our domain.
      const next = searchParams.get('next');
      const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : null;

      const fallback = result.workspaces[0]
        ? `/w/${result.workspaces[0].slug}/inbox`
        : '/onboarding';

      router.replace(safeNext ?? fallback);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-fg-muted">Sign in to your inbox.</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" loading={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-fg-muted">
        New here?{' '}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create a workspace
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during static prerendering.
  return (
    <Suspense fallback={<Card className="h-[420px] animate-pulse"><span className="sr-only">Loading</span></Card>}>
      <LoginForm />
    </Suspense>
  );
}
