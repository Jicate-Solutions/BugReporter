'use client';

/**
 * Switch one Windows box (and every JICATE worker on it) to one Claude account
 * in a single step. Platform admins only; calls the boxes PATCH route, which
 * accepts an account only when its key is stored in the Control Tower. A box
 * with no JICATE worker can be switched too. "default" is shown as the box's
 * own Windows sign-in.
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
const OWN_SIGNIN = 'own Windows sign-in';

export function BoxAccountEditor({
  host,
  name,
  workers,
  current,
  labels
}: {
  /** The computer name the Control Tower knows the box by. */
  host: string;
  /** What the page calls the box ("Box 1"). */
  name: string;
  workers: string[];
  /** The box's choice, else the account every worker on it uses, or null when they differ or nothing is chosen. */
  current: string | null;
  /** Accounts whose key is stored in the Control Tower. */
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
      toast.success(
        `${name} switches to ${choice === DEFAULT ? `its ${OWN_SIGNIN}` : choice} within a minute (workers from their next job).`
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger className="h-8 w-48" aria-label={`Claude account for ${name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {start === MIXED && (
            <SelectItem value={MIXED} disabled>
              {workers.length ? 'mixed' : 'not chosen'}
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o === DEFAULT ? OWN_SIGNIN : o === 'auto' ? 'auto (priority list)' : o}
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
