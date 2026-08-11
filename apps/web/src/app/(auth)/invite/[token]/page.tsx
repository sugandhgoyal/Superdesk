import Link from 'next/link';
import { previewInvite } from '@/lib/invites';
import { isAppError } from '@superdesk/shared/errors';
import { Alert, Card } from '@/components/ui';
import { AcceptInviteForm } from './accept-form';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let preview;
  try {
    preview = await previewInvite(token);
  } catch (err) {
    return (
      <Card className="p-6 sm:p-7">
        <h1 className="mb-3 text-xl font-semibold tracking-tight">
          Invitation unavailable
        </h1>
        <Alert>
          {isAppError(err)
            ? err.publicMessage
            : 'This invitation link is no longer valid.'}
        </Alert>
        <p className="mt-5 text-center text-sm text-fg-muted">
          <Link href="/login" className="font-medium text-accent hover:underline">
            Go to sign in
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-7">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Join {preview.workspaceName}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          You've been invited as {preview.role === 'ADMIN' ? 'an admin' : 'an agent'}.
        </p>
      </div>

      <AcceptInviteForm
        token={token}
        email={preview.email}
        hasAccount={preview.hasAccount}
      />
    </Card>
  );
}
