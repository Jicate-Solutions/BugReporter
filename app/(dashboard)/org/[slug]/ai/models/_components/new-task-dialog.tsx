'use client';

/**
 * "New AI task" — for developers of an app. The task belongs to one of the
 * apps the person is on, and starts switched OFF. The server re-checks that
 * the person belongs to the chosen app.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { deriveJobType } from '@/lib/ai-engine/task-key';
import { EMPTY_RECIPE, RecipeFields, postJson, type RecipeValue } from './recipe-fields';

export interface AppChoice {
  id: string;
  name: string;
  slug: string;
}

export function NewTaskDialog({ apps }: { apps: AppChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState(apps.length === 1 ? apps[0].id : '');
  const [name, setName] = useState('');
  const [recipe, setRecipe] = useState<RecipeValue>(EMPTY_RECIPE);
  const [saving, setSaving] = useState(false);

  const app = apps.find((a) => a.id === appId);
  const key = app && name.trim() ? deriveJobType(app.slug, name) : null;
  const ready =
    Boolean(app) && key?.ok === true && recipe.instructions.trim().length >= 20 && !saving;

  function reset() {
    setName('');
    setRecipe(EMPTY_RECIPE);
  }

  async function create() {
    if (!app) return;
    setSaving(true);
    const out = await postJson<{ job_type: string }>(
      '/api/internal/ai-engine/task-builder/tasks',
      { app_id: app.id, name: name.trim(), recipe: { ...recipe, title: name.trim() } },
      (m) => toast.error(m)
    );
    setSaving(false);
    if (!out) return;
    toast.success(`Created ${out.job_type}. It is switched off until a test run passes.`);
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New AI task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New AI task</DialogTitle>
          <DialogDescription>
            A task is a set of instructions your app can ask the AI to follow. It starts switched
            off, and can be switched on once a test run passes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>App it belongs to</Label>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose an app" />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-task-name">Task name</Label>
              <Input
                id="new-task-name"
                value={name}
                maxLength={60}
                placeholder="Summarize feedback"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          {key && (
            <p className="text-muted-foreground text-xs">
              {key.ok ? (
                <>
                  Apps will call it as <code className="text-foreground">{key.jobType}</code>
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">{key.message}</span>
              )}
            </p>
          )}

          <RecipeFields value={recipe} onChange={setRecipe} idPrefix="new-task" showTitle={false} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!ready}>
            {saving ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
