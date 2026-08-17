/**
 * Routine registry — the extensibility spine of the App Routines subsystem.
 *
 * Each RoutineKind declares what it does, its default cadence, and how it runs:
 *   mode 'engine' — buildInput() computes the AI-engine payload from live data
 *                   (service-role client, works from a session-less cron);
 *   mode 'direct' — execute() calls the target app over HTTPS and the result
 *                   comes back in the same request (no engine job, no queue).
 * Adding a new capability later = one entry here + its buildInput/execute + a
 * catalog entry — no rebuild. Only READ-ONLY kinds are ever auto-run (enforced
 * by the `readOnly` invariant + the dispatcher).
 *
 * v1 seeded `app.brief`; the `buildwise.*` lane adds four direct-compute kinds.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCatalogEntry } from './catalog';

export interface RoutineContext {
  admin: SupabaseClient;
  organizationId: string;
  applicationId: string | null; // null = fleet-level (org-wide)
  routineId: string; // used to build a stable per-routine dedupe key
}

export interface RoutineInput {
  task: string;
  payload: Record<string, string>;
  dedupeKey?: string;
}

interface RoutineKindBase {
  id: string;
  name: string;
  whatItDoes: string;
  readOnly: true; // ONLY read-only kinds are auto-runnable (safety invariant)
  defaultDaysOfWeek: number[];
  defaultMinuteOfDay: number;
}

/** Runs via the MyJKKN AI engine: buildInput → enqueue → COLLECT polls the job. */
export interface EngineRoutineKind extends RoutineKindBase {
  mode: 'engine';
  /** Engine input, or null when there's nothing to report → an "all clear" run (no engine call). */
  buildInput: (ctx: RoutineContext) => Promise<RoutineInput | null>;
}

export type DirectRunOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Runs as a DIRECT HTTP compute call: the target app does the work and the answer
 * comes back in the same request. No engine job is enqueued, so there is nothing
 * for the dispatcher's COLLECT phase to poll — the run row is terminal on insert.
 * (Deliberate: do NOT wire these through enqueueJob — that queue's consumer is the
 * MyJKKN AI Door, which knows nothing about these tasks. A queued job would sit
 * unconsumed forever.)
 */
export interface DirectRoutineKind extends RoutineKindBase {
  mode: 'direct';
  execute: (ctx: RoutineContext) => Promise<DirectRunOutcome>;
}

export type RoutineKind = EngineRoutineKind | DirectRoutineKind;

// ── shared stats helper (service-role; app-scoped when applicationId set) ─────
interface BugRow {
  application_id: string | null;
  status: string | null;
  category: string | null;
  created_at: string;
  resolved_at: string | null;
}

async function buildBugStats(
  ctx: RoutineContext
): Promise<{ stats: string; total: number; label: string }> {
  const { admin, organizationId, applicationId } = ctx;
  const PAGE = 1000;
  const bugs: BugRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from('bug_reports')
      .select('application_id, status, category, created_at, resolved_at')
      .eq('organization_id', organizationId);
    if (applicationId) q = q.eq('application_id', applicationId);
    const { data, error } = await q.order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BugRow[];
    bugs.push(...rows);
    if (rows.length < PAGE) break;
  }

  let orgName = 'organization';
  const { data: org } = await admin.from('organizations').select('name').eq('id', organizationId).single();
  if (org?.name) orgName = org.name as string;
  let appName: string | null = null;
  if (applicationId) {
    const { data: app } = await admin.from('applications').select('name').eq('id', applicationId).single();
    appName = (app?.name as string) ?? 'app';
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * day;
  const isClosed = (s: string | null) => s === 'wont_fix';
  const isActive = (s: string | null) => s !== 'resolved' && !isClosed(s);

  const total = bugs.length;
  const active = bugs.filter((b) => isActive(b.status)).length;
  const stale = bugs.filter((b) => isActive(b.status) && new Date(b.created_at).getTime() < monthAgo).length;
  const new30 = bugs.filter((b) => new Date(b.created_at).getTime() > monthAgo).length;
  const resolved30 = bugs.filter(
    (b) => b.status === 'resolved' && b.resolved_at && new Date(b.resolved_at).getTime() > monthAgo
  ).length;
  const catCounts = new Map<string, number>();
  for (const b of bugs) {
    const c = b.category ?? 'other';
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const catLine = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(', ');
  const securityActive = bugs.filter((b) => b.category === 'security' && isActive(b.status)).length;

  const label = appName ? `${orgName} — ${appName}` : orgName;
  const head = appName ? `App "${appName}" — total bugs: ${total}.` : `Total bugs: ${total}.`;
  const stats = [
    head,
    `Open (active) now: ${active}; of these ${stale} have been open longer than 30 days.`,
    `Last 30 days: ${new30} new vs ${resolved30} resolved (backlog change ${new30 - resolved30 >= 0 ? '+' : ''}${new30 - resolved30}).`,
    `Categories: ${catLine || 'none'}.`,
    `Open security bugs: ${securityActive}.`,
    `Scope: ${label}.`
  ].join('\n');

  return { stats, total, label };
}

// ── kinds ────────────────────────────────────────────────────────────────────
const APP_BRIEF: RoutineKind = {
  ...getCatalogEntry('app.brief')!, // id, name, whatItDoes, default cadence
  mode: 'engine',
  readOnly: true,
  buildInput: async (ctx) => {
    const { stats, total, label } = await buildBugStats(ctx);
    if (total === 0) return null; // nothing to brief → all-clear run, no engine call
    const utcDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return {
      task: 'ops.brief',
      payload: { org: label, stats },
      // Per-routine-per-day key so the Door collapses any retry into one job.
      dedupeKey: `app.brief:${ctx.routineId}:${utcDate}`
    };
  }
};

// ── BuildWise lane (direct HTTP compute — no AI engine, no queue) ─────────────
// Each kind POSTs {application.app_url}/api/jobs/<job> with the shared
// x-jobs-secret header. BuildWise does the compute and replies { ok, summary }
// in the same request; the summary is stored as the run result ({ answer }).
//
// These calls never go through the MyJKKN AI engine (no enqueueJob) — they are
// synchronous compute requests to the app itself. Do not "fix" this by wiring a
// queue: there is no consumer for these tasks on the Door side.

const BUILDWISE_JOB_TIMEOUT_MS = 60000;
const BUILDWISE_ERROR_BODY_MAX = 2000; // keep run.error readable, not a body dump

async function runBuildWiseJob(ctx: RoutineContext, jobName: string): Promise<DirectRunOutcome> {
  if (!ctx.applicationId) {
    return { ok: false, error: 'BuildWise routines are app-scoped — attach the routine to an application, not the fleet.' };
  }
  const secret = process.env.BUILDWISE_JOBS_SECRET;
  if (!secret) return { ok: false, error: 'BUILDWISE_JOBS_SECRET is not configured on the platform.' };

  const { data: app, error: appErr } = await ctx.admin
    .from('applications')
    .select('app_url')
    .eq('id', ctx.applicationId)
    .single();
  const appUrl = (app?.app_url as string | null) ?? null;
  if (appErr || !appUrl) return { ok: false, error: 'The application has no app_url to call.' };

  const url = `${appUrl.replace(/\/+$/, '')}/api/jobs/${jobName}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'x-jobs-secret': secret },
      cache: 'no-store',
      signal: AbortSignal.timeout(BUILDWISE_JOB_TIMEOUT_MS)
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `BuildWise unreachable (${jobName})` };
  }

  const body = await res.text().catch(() => '');
  const trimmed = body.length > BUILDWISE_ERROR_BODY_MAX ? `${body.slice(0, BUILDWISE_ERROR_BODY_MAX)}…` : body;
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${trimmed || 'no body'}` };

  let data: { ok?: boolean; summary?: string } | null = null;
  try {
    data = JSON.parse(body) as { ok?: boolean; summary?: string };
  } catch {
    return { ok: false, error: `non-JSON response: ${trimmed || 'empty body'}` };
  }
  if (data?.ok !== true) return { ok: false, error: trimmed || 'BuildWise returned ok:false' };

  // { answer } matches the existing run-result convention (what the UI renders).
  return { ok: true, result: { answer: data.summary ?? 'Done — BuildWise returned no summary text.' } };
}

function buildwiseKind(catalogId: string, jobName: string): DirectRoutineKind {
  return {
    ...getCatalogEntry(catalogId)!, // id, name, whatItDoes, default cadence
    mode: 'direct',
    // readOnly here means: nothing THIS PLATFORM can be blamed for reaches a human.
    // The BuildWise job may write DRAFT alert rows inside BuildWise itself (its own
    // data, never sent to anyone). Nothing user-facing is sent by this routine —
    // that is the dispatcher invariant ("can't close a bug or message a human"),
    // and it holds. Flagged in the PR body for the maintainer to judge.
    readOnly: true,
    execute: (ctx) => runBuildWiseJob(ctx, jobName)
  };
}

export const ROUTINE_KINDS: RoutineKind[] = [
  APP_BRIEF,
  buildwiseKind('buildwise.cash-digest', 'cash-digest'),
  buildwiseKind('buildwise.budget-watchdog', 'budget-watchdog'),
  buildwiseKind('buildwise.anomaly-scan', 'anomaly-scan'),
  buildwiseKind('buildwise.reconcile', 'reconcile')
];

export const getRoutineKind = (id: string): RoutineKind | undefined =>
  ROUTINE_KINDS.find((k) => k.id === id);
