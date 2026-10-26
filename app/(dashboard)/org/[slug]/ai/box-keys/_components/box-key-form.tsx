'use client';

/**
 * Set or replace one box key. The value is sent once, stored encrypted and
 * never shown again; the box agent writes it into the file on its next check.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BoxKeyForm({ target, name, isSet }: { target: string; name: string; isSet: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!isSet);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/box-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, value: value.trim() })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the key.');
        return;
      }
      toast.success(`${name} saved. The box writes it within a minute or two.`);
      setValue('');
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Replace
      </Button>
    );
  }

  const id = `box-key-${target}`;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
      <div className="min-w-[14rem] flex-1 space-y-1">
        <Label className="text-xs" htmlFor={id}>
          {isSet ? `New value for ${name}` : `Value for ${name}`}
        </Label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="h-8"
          placeholder="paste the key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button size="sm" onClick={save} disabled={saving || value.trim().length < 8}>
        {saving ? 'Saving…' : 'Save key'}
      </Button>
      {isSet && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue('');
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
