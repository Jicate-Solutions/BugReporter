'use client';

/**
 * Pick which Claude account one JICATE worker runs on, and whether it may fall
 * back to the worker's other accounts when one hits its limit. Platform admins
 * only (the page renders this only for them, and the PATCH route re-checks).
 * The list holds only the labels the worker itself reported; keys never leave
 * the Windows box.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export interface EditableRunner {
  name: string;
  account: string | null;
  account_fallback: boolean;
  accounts_available: string[];
  account_in_use: string | null;
}

const DEFAULT = 'default';

export function RunnerAccountEditor({ runner }: { runner: EditableRunner }) {
  const router = useRouter();
  const [account, setAccount] = useState(runner.account ?? DEFAULT);
  const [fallback, setFallback] = useState(runner.account_fallback);
  const [saving, setSaving] = useState(false);

  const options = [DEFAULT, ...runner.accounts_available.filter((a) => a !== DEFAULT), 'auto'];
  if (!options.includes(account)) options.push(account);
  const dirty = account !== (runner.account ?? DEFAULT) || fallback !== runner.account_fallback;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/runners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: runner.name,
          account: account === DEFAULT ? null : account,
          account_fallback: fallback
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success(`${runner.name} will use ${account} from its next job.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={account} onValueChange={setAccount}>
        <SelectTrigger className="h-8 w-32" aria-label={`Claude account for ${runner.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o === DEFAULT ? 'default (box sign-in)' : o === 'auto' ? 'auto (priority list)' : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1 text-xs">
        <Switch checked={fallback} onCheckedChange={setFallback} aria-label="Fall back to other accounts" />
        fall back
      </label>
      {dirty && (
        <Button size="sm" variant="outline" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
      {runner.account_in_use && (
        <span className="text-muted-foreground text-xs">last job: {runner.account_in_use}</span>
      )}
    </div>
  );
}
