'use client';

/**
 * Org owners / admins only (the page renders these only for them, and
 * /api/internal/ai-engine/billing re-checks):
 *   - AppClientSelect: which client an app is billed to
 *   - ClientDiscountEditor: one client's discount
 *   - AddClientForm: add a client by its MyJKKN id plus a name to show
 * MyJKKN stays the master list of clients; only the id and a name are kept.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const NONE = '__none__';

async function send(method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
  const res = await fetch('/api/internal/ai-engine/billing', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? 'Could not save the change.';
}

export function AppClientSelect({
  applicationId,
  appName,
  clientId,
  clients
}: {
  applicationId: string;
  appName: string;
  clientId: string | null;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function change(v: string) {
    const next = v === NONE ? null : v;
    if (next === clientId) return;
    setSaving(true);
    try {
      const err = await send('PATCH', { application_id: applicationId, myjkkn_client_id: next });
      if (err) {
        toast.error(err);
        return;
      }
      const name = clients.find((c) => c.id === next)?.name;
      toast.success(name ? `${appName} is now billed to ${name}.` : `${appName}: no client linked (0% discount).`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select value={clientId ?? NONE} onValueChange={change} disabled={saving}>
      <SelectTrigger className="h-8 w-44" aria-label={`Client for ${appName}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No client linked</SelectItem>
        {clients.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ClientDiscountEditor({
  clientId,
  name,
  discount
}: {
  clientId: string;
  name: string;
  discount: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(discount));
  const [saving, setSaving] = useState(false);
  const dirty = value !== String(discount);

  async function save() {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) {
      toast.error('Use a number from 0 to 100, with at most 2 decimals.');
      return;
    }
    setSaving(true);
    try {
      const err = await send('PATCH', { myjkkn_client_id: clientId, discount_pct: n });
      if (err) {
        toast.error(err);
        return;
      }
      toast.success(`${name}: ${n}% discount.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-8 w-20 text-right"
        inputMode="decimal"
        aria-label={`Discount for ${name} (%)`}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, '').slice(0, 6))}
      />
      <span className="text-muted-foreground text-sm">%</span>
      {dirty && (
        <Button size="sm" variant="outline" className="h-8" onClick={save} disabled={saving}>
          {saving ? '…' : 'Save'}
        </Button>
      )}
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AddClientForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!UUID_RE.test(id.trim())) {
      toast.error('Paste the client id from MyJKKN (it looks like 1a2b3c4d-…).');
      return;
    }
    if (!name.trim()) {
      toast.error('Give the client name as it appears in MyJKKN.');
      return;
    }
    setSaving(true);
    try {
      const err = await send('POST', {
        organization_id: organizationId,
        myjkkn_client_id: id.trim().toLowerCase(),
        name: name.trim()
      });
      if (err) {
        toast.error(err);
        return;
      }
      toast.success(`${name.trim()} added at 0% discount.`);
      setId('');
      setName('');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="bill-client-id">MyJKKN client id</Label>
        <Input
          id="bill-client-id"
          className="w-80 font-mono text-xs"
          placeholder="00000000-0000-0000-0000-000000000000"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bill-client-name">Name (as in MyJKKN)</Label>
        <Input
          id="bill-client-name"
          className="w-56"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={saving}>
        {saving ? 'Adding…' : 'Add client'}
      </Button>
    </form>
  );
}
