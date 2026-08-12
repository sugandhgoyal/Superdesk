'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    router.replace('/login');
    router.refresh();
  }

  return (
    <Button type="button" variant="ghost" size="sm" loading={busy} onClick={signOut}>
      Sign out
    </Button>
  );
}
