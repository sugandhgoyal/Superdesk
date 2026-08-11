'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Alert, Button, Field, Input } from '@/components/ui';

export function AcceptInviteForm({
  token,
  email,
  hasAccount,
}: {
  token: string;
  email: string;
  hasAccount: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await api<{ workspaceSlug: string }>(
        '/api/invites/accept',
        {
          method: 'POST',
          body: {
            token,
            name: String(form.get('name') ?? ''),
            password: String(form.get('password') ?? ''),
          },
        },
      );
      router.replace(`/w/${result.workspaceSlug}/inbox`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <Field label="Email" htmlFor="email">
        {/* Fixed to the invited address — letting it be edited would turn any
            invite into an account for an arbitrary email. */}
        <Input id="email" value={email} disabled readOnly />
      </Field>

      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>

      <Field
        label={hasAccount ? 'Your existing password' : 'Create a password'}
        htmlFor="password"
        hint={hasAccount ? undefined : 'At least 10 characters.'}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={hasAccount ? 'current-password' : 'new-password'}
          required
        />
      </Field>

      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? 'Joining…' : 'Join workspace'}
      </Button>
    </form>
  );
}
