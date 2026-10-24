'use client';

/**
 * Per-task builder controls on the AI Models page: switch off (immediate),
 * switch on (only after a passed test), edit the recipe as a draft, the
 * version history with Restore, and — for platform admins — change the owner.
 *
 * The page decides which controls to show; every route re-checks on the server.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { RecipeFields, postJson, type RecipeValue } from './recipe-fields';

interface VersionItem {
  version: number;
  status: 'draft' | 'published' | 'restored';
  created_at: string;
  created_by_email: string | null;
  tested_ok_at: string | null;
  recipe: RecipeValue;
}

const STATUS_LABEL: Record<VersionItem['status'], string> = {
  draft: 'draft — waiting for a test',
  published: 'published',
  restored: 'restored by a platform admin'
};

export function TaskBuilderPanel({
  jobType,
  enabled,
  recipe,
  ownerLabel,
  appLabel,
  canEdit,
  canSwitchOff,
  superAdmin
}: {
  jobType: string;
  enabled: boolean;
  recipe: RecipeValue;
  ownerLabel: string;
  appLabel: string;
  canEdit: boolean;
  canSwitchOff: boolean;
  superAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<RecipeValue>(recipe);
  const [history, setHistory] = useState<VersionItem[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');

  async function switchTo(on: boolean) {
    setBusy(true);
    const out = await postJson<{ enabled: boolean }>(
      '/api/internal/ai-engine/task-builder/switch',
      { job_type: jobType, on },
      (m) => toast.error(m)
    );
    setBusy(false);
    if (!out) return;
    toast.success(on ? `${jobType} switched on` : `${jobType} switched off`);
    router.refresh();
  }

  async function loadHistory() {
    try {
      const res = await fetch(
        `/api/internal/ai-engine/task-builder/versions?job_type=${encodeURIComponent(jobType)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const data = (await res.json().catch(() => null)) as {
        versions?: VersionItem[];
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Could not load the history.');
        return;
      }
      setHistory(data?.versions ?? []);
    } catch {
      toast.error('Could not reach the server. Try again.');
    }
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) await loadHistory();
  }

  async function saveDraft() {
    setBusy(true);
    const out = await postJson<{ version: number }>(
      '/api/internal/ai-engine/task-builder/versions',
      { job_type: jobType, recipe: draft },
      (m) => toast.error(m)
    );
    setBusy(false);
    if (!out) return;
    toast.success(`Saved as draft version ${out.version}. The live task is unchanged until a test run passes.`);
    setEditOpen(false);
    if (historyOpen) await loadHistory();
  }

  async function restore(version: number) {
    setBusy(true);
    const out = await postJson<{ version: number; applied: boolean }>(
      '/api/internal/ai-engine/task-builder/restore',
      { job_type: jobType, version },
      (m) => toast.error(m)
    );
    setBusy(false);
    if (!out) return;
    toast.success(
      out.applied
        ? `Restored version ${version}. It is live now.`
        : `Restored version ${version} as draft version ${out.version}. It goes live after a test run passes.`
    );
    await loadHistory();
    if (out.applied) router.refresh();
  }

  async function changeOwner() {
    setBusy(true);
    const out = await postJson<{ owner_email: string }>(
      '/api/internal/ai-engine/task-builder/owner',
      { job_type: jobType, owner_email: ownerEmail },
      (m) => toast.error(m)
    );
    setBusy(false);
    if (!out) return;
    toast.success(`${jobType} now belongs to ${out.owner_email}`);
    setOwnerEmail('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>Owner: {ownerLabel}</span>
        <span>App: {appLabel}</span>
        <span>Waits up to {recipe.queue_wait_seconds}s for a free box</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {enabled && canSwitchOff && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => switchTo(false)}>
            Switch off now
          </Button>
        )}
        {!enabled && canEdit && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => switchTo(true)}>
            Switch on
          </Button>
        )}

        {canEdit && (
          <Dialog
            open={editOpen}
            onOpenChange={(o) => {
              setEditOpen(o);
              if (o) setDraft(recipe);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                Edit recipe
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit {jobType}</DialogTitle>
                <DialogDescription>
                  Your changes are saved as a draft. The live task keeps working exactly as now
                  until a test run of the draft passes.
                </DialogDescription>
              </DialogHeader>
              <RecipeFields value={draft} onChange={setDraft} idPrefix={`edit-${jobType}`} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={saveDraft}
                  disabled={busy || draft.instructions.trim().length < 20 || draft.title.trim().length < 2}
                >
                  {busy ? 'Saving…' : 'Save draft'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {(canEdit || canSwitchOff) && (
          <Button size="sm" variant="ghost" onClick={toggleHistory}>
            {historyOpen ? 'Hide version history' : 'Version history'}
          </Button>
        )}
      </div>

      {historyOpen && (
        <div className="rounded-md border">
          {history === null ? (
            <p className="text-muted-foreground p-3 text-sm">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">
              No saved versions yet. The first edit keeps today&apos;s recipe as version 1.
            </p>
          ) : (
            <ul className="divide-y">
              {history.map((v, i) => (
                <li key={v.version} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className="font-medium">Version {v.version}</span>
                  <Badge variant={v.status === 'draft' ? 'secondary' : 'outline'}>
                    {STATUS_LABEL[v.status]}
                  </Badge>
                  {v.tested_ok_at && (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">test passed</Badge>
                  )}
                  <span className="text-muted-foreground">
                    {new Date(v.created_at).toLocaleString()} · {v.created_by_email ?? 'system'} ·{' '}
                    {v.recipe.model}
                  </span>
                  {canEdit && i > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => restore(v.version)}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {superAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            className="h-8 w-64"
            placeholder="new owner's email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !ownerEmail.includes('@')}
            onClick={changeOwner}
          >
            Change owner
          </Button>
        </div>
      )}
    </div>
  );
}
