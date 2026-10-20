'use client';

/**
 * Switch every JICATE worker on one Windows box to one Claude account in a
 * single step. Platform admins only; calls the per-worker PATCH route for each
 * worker on the box, which re-checks the label against what that worker holds.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const DEFAULT = 'default';
const MIXED = '__mixed__';

export function BoxAccountEditor({
  host,
  current,
  labels
}: {
  host: string;
  workers: string[];
  /** The account every worker on the box uses, or null when they differ. */
  current: string | null;
  /** Labels held by EVERY worker on this box. */
  labels: string[];
}) {
  const router = useRouter();
  const start = current ?? MIXED;
  const [choice, setChoice] = useState(start);
  const [saving, setSaving] = useState(false);
  const options = [DEFAULT, ...labels.filter((l) => l !== DEFAULT), 'auto'];

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/boxes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, account: choice })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success(`${host} switches to ${choice} within a minute (workers from their next job).`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger className="h-8 w-44" aria-label={`Claude account for ${host}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {start === MIXED && (
            <SelectItem value={MIXED} disabled>
              mixed
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o === DEFAULT ? 'default (box sign-in)' : o === 'auto' ? 'auto (priority list)' : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choice !== start && choice !== MIXED && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Switching…' : 'Switch box'}
        </Button>
      )}
    </div>
  );
}
