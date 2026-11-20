'use client';

/**
 * Add a Claude account (or replace its key) from the Control Tower. Platform
 * admins only. The key comes from `claude setup-token`; it is sent once, stored
 * encrypted, and never shown again. A value that is not shaped like such a key
 * is refused here, before anything is sent, with one plain sentence; the route
 * applies the same rule (lib/ai-engine/account-key-shape.ts).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { accountKeyProblem } from '@/lib/ai-engine/account-key-shape';
import { buildAddAccountBody } from './add-account-body';

export function AddAccountForm() {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [priority, setPriority] = useState('');
  const [saving, setSaving] = useState(false);
  const keyProblem = key.trim() ? accountKeyProblem(key) : null;

  async function save() {
    // An empty Priority box sends no priority at all, so re-pasting a key for an
    // existing account keeps the priority it already has (a new account gets none).
    const body = buildAddAccountBody(label, key, priority);
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the account.');
        return;
      }
      toast.success(
        json?.check_queued
          ? `${label.trim()} saved. Checking the key now. The result shows on its row in about a minute.`
          : `${label.trim()} saved. Its key is checked within about 20 minutes; the result shows on its row.`
      );
      setLabel('');
      setKey('');
      setPriority('');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Add a Claude account</p>
      <p className="text-muted-foreground text-xs">
        On any computer, run <code>claude setup-token</code> in a terminal, sign in to the account,
        and paste the long key it prints here (it starts with sk-ant-oat01-). Using an existing name replaces that account&apos;s key; leave Priority empty to keep its current priority.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="acct-label">Name</Label>
          <Input
            id="acct-label"
            className="h-8 w-28"
            placeholder="acct1"
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 31))}
          />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1">
          <Label className="text-xs" htmlFor="acct-key">Key</Label>
          <Input
            id="acct-key"
            type="password"
            autoComplete="off"
            className="h-8"
            placeholder="paste the key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="acct-prio">Priority</Label>
          <Input
            id="acct-prio"
            className="h-8 w-16"
            inputMode="numeric"
            placeholder="1"
            value={priority}
            onChange={(e) => setPriority(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          />
        </div>
        <Button size="sm" onClick={save} disabled={saving || !label || !key.trim() || keyProblem !== null}>
          {saving ? 'Saving…' : 'Save account'}
        </Button>
      </div>
      {keyProblem && (
        <p role="alert" className="text-xs text-red-600">
          {keyProblem}
        </p>
      )}
    </div>
  );
}
