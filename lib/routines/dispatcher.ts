/**
 * Routine dispatcher — the engine of the App Routines subsystem.
 *
 * Runs on the reporter's cron (session-less, service-role). Three phases:
 *   1. FIRE    — atomically claim due routines (fn_app_routine_claim_due), build
 *                each one's input, enqueue it on the ₹0 Max lane (or record an
 *                "all clear" run when there's nothing to report).
 *   2. COLLECT — poll in-flight runs and store results when the engine finishes.
 *   3. PRUNE   — 90-day run-history retention.
 *
 * Safety: only read-only routine kinds exist in the registry, so nothing here can
 * close a bug or message a human. Isolation stays per-org (reporter-<orgId>).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { engineConfig, enqueueJob, pollJob } from './engine';
import { getRoutineKind } from './registry';

interface RoutineRow {
  id: string;
  organization_id: string;
  application_id: string | null;
  routine_kind: string;
}

interface RunRow {
  id: string;
  organization_id: string;
  job_id: string | null;
  routine_kind: string;
  routine_id: string;
}

export interface DispatchSummary {
  claimed: number;
  enqueued: number;
  allClear: number;
  failed: number;
  collected: number;
  pruned: number;
}

export async function runDispatcher(admin: SupabaseClient): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, enqueued: 0, allClear: 0, failed: 0, collected: 0, pruned: 0 };
  const cfg = engineConfig();

  // ── 1. FIRE ────────────────────────────────────────────────────────────────
  const { data: due, error: dueErr } = await admin.rpc('fn_app_routine_claim_due', { p_limit: 25 });
  if (dueErr) throw new Error(`claim_due failed: ${dueErr.message}`);
  const routines = (due ?? []) as RoutineRow[];
  summary.claimed = routines.length;

  for (const r of routines) {
    const kind = getRoutineKind(r.routine_kind);
    if (!kind) {
      await recordRun(admin, r, 'error', null, null, `unknown routine kind: ${r.routine_kind}`);
      await finish(admin, r.id, 'error');
      summary.failed++;
      continue;
    }
    try {
      const input = await kind.buildInput({
        admin,
        organizationId: r.organization_id,
        applicationId: r.application_id
      });

      if (input === null) {
        // Nothing to report → record an "all clear" run, no engine call.
        await recordRun(admin, r, 'done', null, { allClear: true }, null, new Date().toISOString());
        await finish(admin, r.id, 'done');
        summary.allClear++;
        continue;
      }

      if (!cfg) {
        await recordRun(admin, r, 'error', null, null, 'AI engine not configured (MYJKKN_AI_URL/KEY)');
        await finish(admin, r.id, 'error');
        summary.failed++;
        continue;
      }

      const { jobId, error } = await enqueueJob(cfg, r.organization_id, input.task, input.payload, input.dedupeKey);
      if (!jobId) {
        await recordRun(admin, r, 'error', null, null, error ?? 'enqueue failed');
        await finish(admin, r.id, 'error');
        summary.failed++;
        continue;
      }
      const { error: insErr } = await recordRun(admin, r, 'running', jobId, null, null);
      if (insErr) {
        // Job was enqueued but the run-row insert failed → don't count it as
        // enqueued (COLLECT can't poll a row that doesn't exist); surface as error.
        console.error('[dispatcher] run-row insert failed after enqueue:', insErr);
        await finish(admin, r.id, 'error');
        summary.failed++;
      } else {
        await finish(admin, r.id, 'running');
        summary.enqueued++;
      }
    } catch (e) {
      await recordRun(admin, r, 'error', null, null, e instanceof Error ? e.message : 'buildInput failed');
      await finish(admin, r.id, 'error');
      summary.failed++;
    }
  }

  // ── 2. COLLECT ───────────────────────────────────────────────────────────────
  if (cfg) {
    const { data: pending } = await admin
      .from('app_ai_routine_runs')
      .select('id, organization_id, job_id, routine_kind, routine_id')
      .in('status', ['queued', 'running'])
      .not('job_id', 'is', null)
      .order('started_at', { ascending: true })
      .limit(100);

    for (const run of (pending ?? []) as RunRow[]) {
      if (!run.job_id) continue;
      const p = await pollJob(cfg, run.organization_id, run.job_id);
      if (p.status === 'done') {
        await admin
          .from('app_ai_routine_runs')
          .update({
            status: 'done',
            result: p.answer ? { answer: p.answer } : { allClear: true },
            finished_at: new Date().toISOString()
          })
          .eq('id', run.id);
        await finish(admin, run.routine_id, 'done'); // stamps last_run_at (once-per-day guard)
        summary.collected++;
      } else if (p.status === 'error' || p.status === 'canceled') {
        await admin
          .from('app_ai_routine_runs')
          .update({ status: 'error', error: p.error ?? p.status, finished_at: new Date().toISOString() })
          .eq('id', run.id);
        await finish(admin, run.routine_id, 'error');
        summary.collected++;
      }
      // pending / running / unknown → leave for the next tick
    }
  }

  // ── 3. PRUNE (90-day retention) ───────────────────────────────────────────────
  const { data: pruned } = await admin.rpc('fn_app_routine_prune', { p_days: 90 });
  summary.pruned = typeof pruned === 'number' ? pruned : 0;

  return summary;
}

async function finish(admin: SupabaseClient, routineId: string, status: string): Promise<void> {
  await admin.rpc('fn_app_routine_record_fire', { p_routine_id: routineId, p_status: status });
}

async function recordRun(
  admin: SupabaseClient,
  r: RoutineRow,
  status: string,
  jobId: string | null,
  result: Record<string, unknown> | null,
  error: string | null,
  finishedAt?: string
): Promise<{ error: string | null }> {
  const { error: insErr } = await admin.from('app_ai_routine_runs').insert({
    routine_id: r.id,
    organization_id: r.organization_id,
    application_id: r.application_id,
    routine_kind: r.routine_kind,
    status,
    job_id: jobId,
    result,
    error,
    finished_at: finishedAt ?? null
  });
  return { error: insErr ? insErr.message : null };
}
