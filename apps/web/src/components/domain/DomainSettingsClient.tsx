'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import { fullTimestamp } from '@/lib/format';
import type { DomainInfo } from '@/lib/domains';

const STATUS_TONE: Record<DomainInfo['status'], 'accent' | 'success' | 'warning' | 'neutral'> = {
  PENDING: 'neutral',
  VERIFYING: 'warning',
  ACTIVE: 'success',
  FAILED: 'warning',
};

const STATUS_LABEL: Record<DomainInfo['status'], string> = {
  PENDING: 'Pending',
  VERIFYING: 'Verifying DNS…',
  ACTIVE: 'Active',
  FAILED: 'Failed',
};

export function DomainSettingsClient({
  workspaceSlug,
  isAdmin,
  configured,
  initialInfo,
}: {
  workspaceSlug: string;
  isAdmin: boolean;
  configured: boolean;
  initialInfo: DomainInfo;
}) {
  const [info, setInfo] = useState(initialInfo);
  const [domainInput, setDomainInput] = useState('');
  // Which single action is in flight, if any — not one shared boolean.
  // Three buttons (Connect, Check status, Disconnect) each need their own
  // spinner; a shared flag lit all of them up for whichever one you actually
  // clicked.
  const [pending, setPending] = useState<'add' | 'check' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/w/${workspaceSlug}/domain`;

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    setPending('add');
    setError(null);
    try {
      const result = await api<DomainInfo>(base, { method: 'POST', body: { domain: domainInput } });
      setInfo(result);
      setDomainInput('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add domain');
    } finally {
      setPending(null);
    }
  }

  async function checkStatus() {
    setPending('check');
    setError(null);
    try {
      const result = await api<DomainInfo>(`${base}/verify`, { method: 'POST', body: {} });
      setInfo(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to check status');
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!confirm(`Disconnect ${info.customDomain}? The help center will only be reachable at /help/${workspaceSlug} again.`)) {
      return;
    }
    setPending('remove');
    setError(null);
    try {
      await api(base, { method: 'DELETE' });
      setInfo({ ...info, customDomain: null, status: 'PENDING', verifiedAt: null, lastError: null, verification: [] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove domain');
    } finally {
      setPending(null);
    }
  }

  if (!configured) {
    return (
      <Alert tone="info">
        Custom domains aren&apos;t configured on this deployment (no Vercel API token set). This is an
        explain-only view of the feature — connecting it needs a Vercel token with access to this
        project.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {!info.customDomain ? (
        isAdmin ? (
          <form onSubmit={addDomain} className="space-y-3">
            <Field label="Domain" htmlFor="domain" hint="A subdomain you control, e.g. help.yourcompany.com">
              <Input
                id="domain"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="help.yourcompany.com"
                required
              />
            </Field>
            <Button type="submit" loading={pending === 'add'}>
              Connect domain
            </Button>
          </form>
        ) : (
          <p className="text-sm text-fg-subtle">No custom domain is connected. Ask a workspace admin to set one up.</p>
        )
      ) : (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-sm text-fg">{info.customDomain}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge>
                {info.verifiedAt && (
                  <span className="text-xs text-fg-subtle">Verified {fullTimestamp(info.verifiedAt)}</span>
                )}
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={pending === 'check'}
                  disabled={pending !== null && pending !== 'check'}
                  onClick={checkStatus}
                >
                  Check status
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={pending === 'remove'}
                  disabled={pending !== null && pending !== 'remove'}
                  onClick={remove}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {info.lastError && (
            <p className="mt-3 text-sm text-danger">{info.lastError}</p>
          )}

          {info.status !== 'ACTIVE' && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm font-medium text-fg">Add this DNS record at your registrar:</p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-inset p-3 font-mono text-xs text-fg">
                <div>Type: {info.target.type}</div>
                <div>Name: {info.customDomain}</div>
                <div>Value: {info.target.value}</div>
              </div>

              {info.verification.map((v, i) => (
                <div key={i} className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-inset p-3 font-mono text-xs text-fg">
                  <div>Type: {v.type}</div>
                  <div>Name: {v.domain}</div>
                  <div>Value: {v.value}</div>
                  {v.reason && <div className="mt-1 text-fg-subtle">({v.reason})</div>}
                </div>
              ))}

              <p className="mt-2 text-xs text-fg-subtle">
                DNS changes can take a few minutes to a few hours to propagate. SSL is issued
                automatically once verification succeeds — nothing else to configure.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
