'use client';

/** Priority box for one Claude account (1 = used first in "auto"). Platform admins only. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AccountPriorityEditor({ label, priority }: { label: string; priority: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(priority == null ? '' : String(priority));
  const [saving, setSaving] = useState(false);
  const dirty = value !== (priority == null ? '' : String(priority));

  async function save() {
    const n = value.trim() === '' ? null : Number(value);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 99)) {
      toast.error('Use a whole number from 1 to 99, or leave it empty.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, priority: n })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success(n == null ? `${label}: no priority (used last).` : `${label}: priority ${n}.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-xs">priority</span>
      <Input
        className="h-7 w-14 text-center"
        inputMode="numeric"
        aria-label={`Priority for ${label}`}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
      />
      {dirty && (
        <Button size="sm" variant="outline" className="h-7" onClick={save} disabled={saving}>
          {saving ? '…' : 'Save'}
        </Button>
      )}
    </div>
  );
}
