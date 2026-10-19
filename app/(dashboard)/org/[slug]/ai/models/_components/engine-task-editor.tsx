'use client';

/**
 * Inline settings for one JICATE engine recipe on the AI Models page.
 * Platform admins only (the page renders this only for them, and the PATCH
 * route re-checks). The recipe wording is read-only here on purpose.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];

export interface EditableTask {
  job_type: string;
  enabled: boolean;
  model: string;
  interactive: boolean;
  max_inflight: number;
  timeout_seconds: number;
}

export function EngineTaskEditor({ task }: { task: EditableTask }) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditableTask>(task);
  const [saving, setSaving] = useState(false);

  const dirty =
    draft.enabled !== task.enabled ||
    draft.model !== task.model ||
    draft.interactive !== task.interactive ||
    draft.max_inflight !== task.max_inflight ||
    draft.timeout_seconds !== task.timeout_seconds;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_type: task.job_type,
          enabled: draft.enabled,
          model: draft.model,
          interactive: draft.interactive,
          max_inflight: draft.max_inflight,
          timeout_seconds: draft.timeout_seconds
        }),
        signal: AbortSignal.timeout(15000)
      });
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Could not save.');
        return;
      }
      toast.success(`${task.job_type} saved`);
      router.refresh();
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const models = MODELS.includes(task.model) ? MODELS : [task.model, ...MODELS];

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id={`${task.job_type}-enabled`}
          checked={draft.enabled}
          onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
        />
        <Label htmlFor={`${task.job_type}-enabled`}>On</Label>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Model</Label>
        <Select value={draft.model} onValueChange={(v) => setDraft({ ...draft, model: v })}>
          <SelectTrigger className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${task.job_type}-interactive`}
          checked={draft.interactive}
          onCheckedChange={(v) => setDraft({ ...draft, interactive: v })}
        />
        <Label htmlFor={`${task.job_type}-interactive`}>Person waiting</Label>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">At once</Label>
        <Input
          type="number"
          min={1}
          max={20}
          className="h-8 w-20"
          value={draft.max_inflight}
          onChange={(e) =>
            setDraft({ ...draft, max_inflight: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })
          }
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Time limit (s)</Label>
        <Input
          type="number"
          min={10}
          max={600}
          className="h-8 w-24"
          value={draft.timeout_seconds}
          onChange={(e) =>
            setDraft({
              ...draft,
              timeout_seconds: Math.min(600, Math.max(10, Number(e.target.value) || 10))
            })
          }
        />
      </div>
      <Button size="sm" onClick={save} disabled={!dirty || saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
