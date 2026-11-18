'use client';

/** The idle line knob on the pay-vs-use page. Platform admins only (the route checks). */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function IdleLineEditor({ value }: { value: number }) {
  const router = useRouter();
  const [text, setText] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const dirty = text !== String(value);

  async function save() {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      toast.error('Use a whole number from 1 to 100.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/pay-vs-use', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle_below_pct: n })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the setting.');
        return;
      }
      toast.success(`Accounts under ${n}% average weekly use are now flagged idle.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Flag an account as idle when its average weekly use is under</span>
      <Input
        className="h-8 w-16 text-center"
        inputMode="numeric"
        aria-label="Idle line, percent"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
      />
      <span>%</span>
      {dirty && (
        <Button size="sm" variant="outline" className="h-8" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  );
}
