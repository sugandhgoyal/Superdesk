'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { signupSchema } from '@/lib/validation';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'workspaceName', string>>;

export default function SignupPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      workspaceName: String(form.get('workspaceName') ?? ''),
    };

    // Validate with the same schema the server uses, so the user gets
    // immediate feedback without a round trip and the two can't disagree.
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        if (key && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api<{ workspace: { slug: string } }>(
        '/api/auth/signup',
        { method: 'POST', body: parsed.data },
      );
      router.replace(`/w/${result.workspace.slug}/inbox`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setFieldErrors({ email: err.message });
      } else {
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong',
        );
      }
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Create your workspace
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Start handling chat and email from one inbox.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}

        <Field label="Your name" htmlFor="name" error={fieldErrors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            invalid={Boolean(fieldErrors.name)}
            placeholder="Sugandh Goyal"
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            invalid={Boolean(fieldErrors.email)}
            placeholder="you@company.com"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 10 characters."
          error={fieldErrors.password}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        <Field
          label="Workspace name"
          htmlFor="workspaceName"
          hint="Your company or product name."
          error={fieldErrors.workspaceName}
        >
          <Input
            id="workspaceName"
            name="workspaceName"
            required
            invalid={Boolean(fieldErrors.workspaceName)}
            placeholder="Acme Inc"
          />
        </Field>

        <Button type="submit" loading={submitting} className="w-full">
          {submitting ? 'Creating workspace…' : 'Create workspace'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-fg-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
