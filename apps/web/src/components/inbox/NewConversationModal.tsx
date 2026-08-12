'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';

export function NewConversationModal({
  workspaceSlug,
  onClose,
  onCreated,
}: {
  workspaceSlug: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ id: string }>(`/api/w/${workspaceSlug}/conversations`, {
        method: 'POST',
        body: {
          contactEmail: email,
          contactName: name || undefined,
          subject: subject || undefined,
          bodyText: message,
        },
      });
      onCreated(result.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-fg">New conversation</h2>
        <p className="mt-0.5 text-sm text-fg-subtle">
          Sends a real email to the customer and opens a thread for their reply.
        </p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3.5">
          {error && <Alert>{error}</Alert>}

          <Field label="Customer email" htmlFor="nc-email">
            <Input
              id="nc-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Customer name" htmlFor="nc-name" hint="Optional">
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Subject" htmlFor="nc-subject" hint="Optional">
            <Input id="nc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>

          <Field label="First message" htmlFor="nc-message">
            <Textarea
              id="nc-message"
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Start conversation
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
