'use client';

/** Remove a Claude account's key from the Control Tower. Platform admins only. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function RemoveKeyButton({ label }: { label: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function remove() {
    setSaving(true);
    try {
      const res = await fetch(`/api/internal/ai-engine/accounts?label=${encodeURIComponent(label)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        toast.error('Could not remove the key.');
        return;
      }
      toast.success(`${label}: key removed. Workers stop using it.`);
      router.refresh();
    } finally {
      setSaving(false);
      setArmed(false);
    }
  }

  return armed ? (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="destructive" className="h-7" onClick={remove} disabled={saving}>
        {saving ? '…' : 'Remove key'}
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setArmed(false)}>
        Keep
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setArmed(true)}>
      remove key
    </Button>
  );
}
