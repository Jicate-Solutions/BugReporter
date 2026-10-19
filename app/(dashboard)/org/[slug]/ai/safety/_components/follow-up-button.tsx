'use client';

/** "Followed up" button for one safety alert. Platform admins only. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function FollowUpButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function markDone() {
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/safety-alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success('Marked as followed up.');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={markDone} disabled={saving}>
      {saving ? 'Saving…' : 'Mark followed up'}
    </Button>
  );
}
