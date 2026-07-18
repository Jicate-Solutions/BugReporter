'use client';

/**
 * Routines manager — list / add / enable-pause / schedule / run-now / results.
 * Reads and writes `app_ai_routines` directly via the browser client, so the
 * admins-only write rule is enforced by RLS (not just the UI). Run-now goes
 * through /api/internal/routines/run (needs the server-only Door key).
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Loader2, Play, Trash2, Plus, Clock, Pause, CheckCircle2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ROUTINE_CATALOG,
  getCatalogEntry,
  DAY_LABELS,
  minuteToHHMM,
  hhmmToMinute
} from '@/lib/routines/catalog';

interface RoutineRow {
  id: string;
  organization_id: string;
  application_id: string | null;
  routine_kind: string;
  enabled: boolean;
  days_of_week: number[];
  minute_of_day: number;
  last_status: string | null;
  last_run_at: string | null;
}

interface RunRow {
  routine_id: string;
  status: string;
  result: { answer?: string; allClear?: boolean } | null;
  error: string | null;
  started_at: string;
}

interface AppRow {
  id: string;
  name: string;
}

// Run-now request deadlines. Without these a hung POST/poll leaves the spinner
// stuck forever (mirrors the AI-card timeout fix from PR #9).
const RUN_POST_TIMEOUT_MS = 15000; // enqueue is a quick Door call
const RUN_POLL_TIMEOUT_MS = 10000; // the GET waits up to 8s server-side; give headroom

// Deadline for the direct supabase-js mutations (add / enable / schedule / delete).
// A hung connection with no deadline would leave busyId set forever — buttons
// disabled, spinner up, no recovery but a reload.
const MUTATION_TIMEOUT_MS = 15000;

/**
 * True for an AbortSignal.timeout() rejection (a per-request deadline hit).
 * Detected by name, not `instanceof Error`, because AbortSignal.timeout()
 * rejects with a DOMException, and `DOMException instanceof Error` is false.
 */
function isTimeoutError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'TimeoutError';
}

/**
 * Friendly message for a supabase-js mutation error. Note the abort arrives here
 * as a string message on `{ error }` (postgrest-js catches the aborted fetch and
 * returns it as an error), not a thrown DOMException — so match on the text.
 */
function mutationErrorMessage(error: { message?: string } | null): string {
  const m = error?.message ?? '';
  if (/TimeoutError|AbortError|signal timed out|aborted/i.test(m)) return 'Timed out — please try again.';
  return m || 'Something went wrong. Please try again.';
}

export function RoutinesManager({ organizationId }: { organizationId: string }) {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [routines, setRoutines] = useState<RoutineRow[]>([]);
  const [latestRuns, setLatestRuns] = useState<Record<string, RunRow>>({});
  const [addKind, setAddKind] = useState<string>(ROUTINE_CATALOG[0]?.id ?? 'app.brief');
  const [addApp, setAddApp] = useState<string>('__fleet__');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    let admin = false;
    if (uid) {
      const { data: sa } = await supabase.from('super_admins').select('user_id').eq('user_id', uid).maybeSingle();
      if (sa) admin = true;
      else {
        const { data: mem } = await supabase
          .from('organization_members')
          .select('role')
          .eq('user_id', uid)
          .eq('organization_id', organizationId)
          .maybeSingle();
        admin = !!mem && (mem.role === 'owner' || mem.role === 'admin');
      }
    }
    setIsAdmin(admin);

    const { data: appData } = await supabase
      .from('applications')
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name');
    setApps((appData ?? []) as AppRow[]);

    const { data: rData } = await supabase
      .from('app_ai_routines')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    const rs = (rData ?? []) as RoutineRow[];
    setRoutines(rs);

    if (rs.length > 0) {
      const { data: runData } = await supabase
        .from('app_ai_routine_runs')
        .select('routine_id, status, result, error, started_at')
        .in(
          'routine_id',
          rs.map((r) => r.id)
        )
        .order('started_at', { ascending: false });
      const byRoutine: Record<string, RunRow> = {};
      for (const run of (runData ?? []) as RunRow[]) {
        if (!byRoutine[run.routine_id]) byRoutine[run.routine_id] = run;
      }
      setLatestRuns(byRoutine);
    } else {
      setLatestRuns({});
    }
    setLoading(false);
  }, [supabase, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const appLabel = (id: string | null) =>
    id ? apps.find((a) => a.id === id)?.name ?? 'Unknown app' : 'All apps (fleet)';

  const addRoutine = async () => {
    const entry = getCatalogEntry(addKind);
    if (!entry) return;
    setBusyId('add');
    const { error } = await supabase
      .from('app_ai_routines')
      .insert({
        organization_id: organizationId,
        application_id: addApp === '__fleet__' ? null : addApp,
        routine_kind: addKind,
        enabled: false,
        days_of_week: entry.defaultDaysOfWeek,
        minute_of_day: entry.defaultMinuteOfDay
      })
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    setBusyId(null);
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message) ? 'That routine already exists here.' : mutationErrorMessage(error));
      return;
    }
    toast.success('Routine added (paused). Set a schedule, then enable it.');
    void load();
  };

  const setEnabled = async (r: RoutineRow, enabled: boolean) => {
    setBusyId(r.id);
    const { error } = await supabase
      .from('app_ai_routines')
      .update({ enabled })
      .eq('id', r.id)
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    setBusyId(null);
    if (error) {
      toast.error(mutationErrorMessage(error));
      return;
    }
    void load();
  };

  const saveSchedule = async (r: RoutineRow, days: number[], minute: number) => {
    if (days.length === 0) {
      toast.error('Pick at least one day.');
      return;
    }
    setBusyId(r.id);
    const { error } = await supabase
      .from('app_ai_routines')
      .update({ days_of_week: days, minute_of_day: minute })
      .eq('id', r.id)
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    setBusyId(null);
    if (error) {
      toast.error(mutationErrorMessage(error));
      return;
    }
    toast.success('Schedule saved.');
    void load();
  };

  const removeRoutine = async (r: RoutineRow) => {
    if (!window.confirm('Delete this routine and its run history? This cannot be undone.')) return;
    setBusyId(r.id);
    const { error } = await supabase
      .from('app_ai_routines')
      .delete()
      .eq('id', r.id)
      .abortSignal(AbortSignal.timeout(MUTATION_TIMEOUT_MS));
    setBusyId(null);
    if (error) {
      toast.error(mutationErrorMessage(error));
      return;
    }
    toast.success('Routine deleted.');
    void load();
  };

  const runNow = async (r: RoutineRow) => {
    setBusyId(r.id);
    try {
      const res = await fetch('/api/internal/routines/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineId: r.id }),
        signal: AbortSignal.timeout(RUN_POST_TIMEOUT_MS)
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Run failed.');
        return;
      }
      if (json.status === 'done') {
        toast.success('Ran — nothing to report.');
        await load();
        return;
      }
      const runId = json.runId as string;
      toast.loading('Running…', { id: `run-${r.id}` });
      for (let i = 0; i < 30; i++) {
        await new Promise((r2) => setTimeout(r2, 4000));
        let pj: { status?: string; error?: string };
        try {
          const pr = await fetch(`/api/internal/routines/run?runId=${encodeURIComponent(runId)}`, {
            signal: AbortSignal.timeout(RUN_POLL_TIMEOUT_MS)
          });
          pj = await pr.json();
        } catch {
          // A single slow/aborted poll shouldn't kill the loop — retry next tick.
          continue;
        }
        if (pj.status === 'done') {
          toast.success('Routine ran — result below.', { id: `run-${r.id}` });
          await load();
          return;
        }
        if (pj.status === 'error') {
          toast.error(pj.error ?? 'Run failed.', { id: `run-${r.id}` });
          await load();
          return;
        }
      }
      toast.error('Still running — check back shortly.', { id: `run-${r.id}` });
      await load();
    } catch (e) {
      // The POST itself timed out or failed to reach the server.
      toast.error(isTimeoutError(e) ? 'Run timed out — please try again.' : 'Could not start the run.', {
        id: `run-${r.id}`
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add a routine (admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" /> Add a routine
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-muted-foreground text-xs">Routine</label>
              <Select value={addKind} onValueChange={setAddKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTINE_CATALOG.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-muted-foreground text-xs">Scope</label>
              <Select value={addApp} onValueChange={setAddApp}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__fleet__">All apps (fleet)</SelectItem>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={addRoutine} disabled={busyId === 'add'} className="gap-2">
              {busyId === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add (paused)
            </Button>
          </CardContent>
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">{getCatalogEntry(addKind)?.whatItDoes}</p>
          </CardContent>
        </Card>
      )}

      {routines.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No routines yet.{' '}
            {isAdmin ? 'Add one above to get started.' : 'An admin can set these up.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {routines.map((r) => (
            <RoutineCard
              key={r.id}
              routine={r}
              latestRun={latestRuns[r.id]}
              appLabel={appLabel(r.application_id)}
              isAdmin={isAdmin}
              busy={busyId === r.id}
              onSetEnabled={(enabled) => setEnabled(r, enabled)}
              onSaveSchedule={(days, minute) => saveSchedule(r, days, minute)}
              onRunNow={() => runNow(r)}
              onRemove={() => removeRoutine(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoutineCard({
  routine,
  latestRun,
  appLabel,
  isAdmin,
  busy,
  onSetEnabled,
  onSaveSchedule,
  onRunNow,
  onRemove
}: {
  routine: RoutineRow;
  latestRun: RunRow | undefined;
  appLabel: string;
  isAdmin: boolean;
  busy: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onSaveSchedule: (days: number[], minute: number) => void;
  onRunNow: () => void;
  onRemove: () => void;
}) {
  const meta = getCatalogEntry(routine.routine_kind);
  const [days, setDays] = useState<number[]>(routine.days_of_week);
  const [time, setTime] = useState<string>(minuteToHHMM(routine.minute_of_day));

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const dirty =
    JSON.stringify(days) !== JSON.stringify(routine.days_of_week) ||
    time !== minuteToHHMM(routine.minute_of_day);

  const save = () => {
    const minute = hhmmToMinute(time);
    if (minute === null) {
      toast.error('Time must be HH:MM (00:00–23:45, UTC).');
      return;
    }
    onSaveSchedule(days, minute);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-blue-600" />
            {meta?.name ?? routine.routine_kind}
            <Badge variant="outline">{appLabel}</Badge>
            {routine.enabled ? (
              <Badge className="bg-green-600 text-white hover:bg-green-600">Enabled</Badge>
            ) : (
              <Badge variant="secondary">Paused</Badge>
            )}
            <Badge variant="secondary" className="text-green-600">
              ₹0
            </Badge>
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">{meta?.whatItDoes}</p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" className="gap-1" onClick={onRunNow} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run now
            </Button>
            {routine.enabled ? (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => onSetEnabled(false)} disabled={busy}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button size="sm" className="gap-1" onClick={() => onSetEnabled(true)} disabled={busy}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Enable
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              disabled={busy}
              title="Delete routine"
              aria-label="Delete routine"
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Schedule */}
        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Clock className="h-3.5 w-3.5" /> Schedule (UTC)
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DAY_LABELS.map((label, d) => {
              const on = days.includes(d);
              return (
                <Button
                  key={d}
                  type="button"
                  variant={on ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 w-11 px-0 text-xs"
                  onClick={() => isAdmin && toggleDay(d)}
                  disabled={!isAdmin}
                >
                  {label}
                </Button>
              );
            })}
            <Input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-7 w-20"
              placeholder="HH:MM"
              disabled={!isAdmin}
            />
            {isAdmin && dirty && (
              <Button size="sm" className="h-7" onClick={save} disabled={busy}>
                Save
              </Button>
            )}
          </div>
        </div>

        {/* Latest run */}
        <LatestRun run={latestRun} lastRunAt={routine.last_run_at} />
      </CardContent>
    </Card>
  );
}

function LatestRun({ run, lastRunAt }: { run: RunRow | undefined; lastRunAt: string | null }) {
  if (!run) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-xs">
        No runs yet. Enable it, or use “Run now”.
      </div>
    );
  }
  const when = lastRunAt ? new Date(lastRunAt).toLocaleString() : new Date(run.started_at).toLocaleString();
  if (run.status === 'running' || run.status === 'queued') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Running…
      </div>
    );
  }
  if (run.status === 'error') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-3 text-sm">
        <p className="font-medium text-red-600">Last run failed</p>
        <p className="text-muted-foreground mt-1 text-xs">{run.error ?? 'Unknown error'}</p>
      </div>
    );
  }
  // done
  if (run.result?.allClear) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm">
        <p className="font-medium">All clear</p>
        <p className="text-muted-foreground mt-1 text-xs">Nothing to report · {when}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-3">
      <p className="text-foreground/90 whitespace-pre-line text-sm">{run.result?.answer ?? '—'}</p>
      <p className="text-muted-foreground mt-2 text-xs">Last run · {when} · ₹0</p>
    </div>
  );
}
