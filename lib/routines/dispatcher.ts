/**
 * Routine dispatcher — the engine of the App Routines subsystem.
 *
 * Runs on the reporter's cron (session-less, service-role). Phases:
 *   PRUNE   — 90-day retention (runs FIRST so it can't be starved by a slow COLLECT).
 *   FIRE    — atomically claim due routines, build input, enqueue on the ₹0 Max lane
 *             (or record an "all clear" run when there's nothing to report).
 *   COLLECT — poll fresh in-flight runs (bounded concurrency, short timeout) and
 *             force-fail stale ones (> TTL) so their routine becomes re-claimable.
 *
 * Safety: only read-only routine kinds exist in the registry — nothing here can
 * close a bug or message a human. Isolation stays per-org (reporter-<orgId>).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { engineConfig, enqueueJob, pollJob, type EngineConfig } from './engine';
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
  started_at: string;
}

export interface DispatchSummary {
  claimed: number;
  enqueued: number;
  allClear: number;
  failed: number;
  collected: number;
  staleFailed: number;
  pruned: number;
}

const POLL_TIMEOUT_MS = 8000; // short: hung polls must not blow the 60s cron budget
const STALE_RUN_MS = 45 * 60 * 1000; // a run in-flight longer than this is force-failed
const COLLECT_LIMIT = 40;
const POLL_BATCH = 5; // bounded concurrency

export async function runDispatcher(admin: SupabaseClient): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    claimed: 0,
    enqueued: 0,
    allClear: 0,
    failed: 0,
    collected: 0,
    staleFailed: 0,
    pruned: 0
  };
  const cfg = engineConfig();

  // ── PRUNE (first — always runs) ──────────────────────────────────────────────
  const { data: pruned } = await admin.rpc('fn_app_routine_prune', { p_days: 90 });
  summary.pruned = typeof pruned === 'number' ? pruned : 0;

  // ── FIRE ──────────────────────────────────────────────────────────────────────
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
        applicationId: r.application_id,
        routineId: r.id
      });

      if (input === null) {
        // Nothing to report → "all clear" run, no engine call. Stamp last_run_at now.
        await recordRun(admin, r, 'done', null, { allClear: true }, null, new Date().toISOString());
        await finishDone(admin, r.id, new Date().toISOString());
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
        // Job enqueued but the run-row insert failed → don't count it (COLLECT can't
        // poll a row that doesn't exist). The per-day dedupeKey collapses the retry.
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

  // ── COLLECT ──────────────────────────────────────────────────────────────────
  if (cfg) {
    const { data: pending } = await admin
      .from('app_ai_routine_runs')
      .select('id, organization_id, job_id, routine_kind, routine_id, started_at')
      .in('status', ['queued', 'running'])
      .not('job_id', 'is', null)
      .order('started_at', { ascending: true })
      .limit(COLLECT_LIMIT);

    const runs = (pending ?? []) as RunRow[];
    const now = Date.now();
    const stale = runs.filter((run) => now - new Date(run.started_at).getTime() > STALE_RUN_MS);
    const fresh = runs.filter((run) => now - new Date(run.started_at).getTime() <= STALE_RUN_MS);

    // Force-fail stale in-flight runs so their routine can be re-claimed.
    for (const run of stale) {
      await admin
        .from('app_ai_routine_runs')
        .update({ status: 'error', error: 'timed out (in-flight > 45m)', finished_at: new Date().toISOString() })
        .eq('id', run.id);
      await finish(admin, run.routine_id, 'error');
      summary.staleFailed++;
    }

    // Poll fresh runs in bounded-concurrency batches (short timeout each).
    for (let i = 0; i < fresh.length; i += POLL_BATCH) {
      const batch = fresh.slice(i, i + POLL_BATCH);
      const results = await Promise.all(batch.map((run) => collectOne(admin, cfg, run)));
      summary.collected += results.filter(Boolean).length;
    }
  }

  return summary;
}

async function collectOne(admin: SupabaseClient, cfg: EngineConfig, run: RunRow): Promise<boolean> {
  if (!run.job_id) return false;
  const p = await pollJob(cfg, run.organization_id, run.job_id, POLL_TIMEOUT_MS);
  if (p.status === 'done') {
    await admin
      .from('app_ai_routine_runs')
      .update({
        status: 'done',
        result: p.answer ? { answer: p.answer } : { allClear: true },
        finished_at: new Date().toISOString()
      })
      .eq('id', run.id);
    // Stamp last_run_at from the FIRE time (started_at), not collection wall-clock,
    // so a near-midnight fire collected after UTC-midnight still counts for its day.
    await finishDone(admin, run.routine_id, run.started_at);
    return true;
  }
  if (p.status === 'error' || p.status === 'canceled') {
    await admin
      .from('app_ai_routine_runs')
      .update({ status: 'error', error: p.error ?? p.status, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    await finish(admin, run.routine_id, 'error');
    return true;
  }
  return false; // pending / running / unknown → next tick
}

async function finish(admin: SupabaseClient, routineId: string, status: string): Promise<void> {
  await admin.rpc('fn_app_routine_record_fire', { p_routine_id: routineId, p_status: status });
}

/** Mark done AND stamp last_run_at from the given fire time (the once-per-day guard). */
async function finishDone(admin: SupabaseClient, routineId: string, ranAtIso: string): Promise<void> {
  await admin
    .from('app_ai_routines')
    .update({ last_status: 'done', last_run_at: ranAtIso, updated_at: new Date().toISOString() })
    .eq('id', routineId);
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
