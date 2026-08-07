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
import { isProbeable } from '../uptime/probe';

export interface RoutineContext {
  admin: SupabaseClient;
  organizationId: string;
  applicationId: string | null; // null = fleet-level (org-wide)
  routineId: string; // used to build a stable per-routine dedupe key
  /**
   * Epoch ms after which this caller will be killed by its platform timeout.
   * Set by the cron dispatcher (maxDuration=60); omitted by run-now
   * (maxDuration=90), which can afford the full per-call budget.
   */
  deadlineAt?: number;
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

const BUILDWISE_JOB_TIMEOUT_MS = 60000; // ceiling for one call (run-now can afford it)
const BUILDWISE_MIN_CALL_MS = 5000; // below this, don't start a call we can't finish
const BUILDWISE_ERROR_BODY_MAX = 300; // keep run.error readable, not a body dump

/**
 * Decide whether the shared jobs secret may be sent to this application's URL.
 *
 * applications.app_url is org-admin editable (apps/_components/application-form.tsx)
 * and the Routines UI lets an admin attach any catalogue kind to any application in
 * the org — so the URL on the row is untrusted input, not a constant. Unguarded, an
 * admin could register an app pointing at a host they control, attach a buildwise.*
 * routine, press Run Now and be handed BUILDWISE_JOBS_SECRET.
 *
 * The gate is an operator-set host, NOT the app slug: slug is editable in the same
 * form as app_url, so slug-gating would stop nobody. Unset host = refuse (fail closed).
 */
export function resolveBuildWiseJobUrl(
  appUrl: string | null | undefined,
  jobName: string,
  expectedHost: string | undefined
): { ok: true; url: string } | { ok: false; error: string } {
  if (!appUrl) return { ok: false, error: 'The application has no app_url to call.' };

  const expected = (expectedHost ?? '').trim().toLowerCase();
  if (!expected) {
    return {
      ok: false,
      error: 'BUILDWISE_JOBS_HOST is not configured — refusing to send the jobs secret to an unverified host.'
    };
  }
  // Reuse the uptime probe's private/malformed-host guard rather than a second copy.
  if (!isProbeable(appUrl)) {
    return { ok: false, error: 'The app_url is localhost/private/malformed — refusing to send the jobs secret there.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return { ok: false, error: 'The application has no usable app_url to call.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `Refusing to send the jobs secret over ${parsed.protocol}// — https is required.` };
  }
  if (parsed.hostname.toLowerCase() !== expected) {
    return {
      ok: false,
      error: `Refusing to send the jobs secret to unexpected host "${parsed.hostname}" (expected "${expected}").`
    };
  }

  // Build from the parsed URL so the authority can never be rewritten by the suffix.
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/jobs/${jobName}`;
  return { ok: true, url: parsed.toString() };
}

async function runBuildWiseJob(ctx: RoutineContext, jobName: string): Promise<DirectRunOutcome> {
  if (!ctx.applicationId) {
    return { ok: false, error: 'BuildWise routines are app-scoped — attach the routine to an application, not the fleet.' };
  }

  const { data: app, error: appErr } = await ctx.admin
    .from('applications')
    .select('app_url')
    .eq('id', ctx.applicationId)
    .single();
  if (appErr) return { ok: false, error: 'The application has no app_url to call.' };

  // Destination is validated BEFORE the secret is read — nothing to leak on refusal.
  const target = resolveBuildWiseJobUrl(
    (app?.app_url as string | null) ?? null,
    jobName,
    process.env.BUILDWISE_JOBS_HOST
  );
  if (!target.ok) return { ok: false, error: target.error };

  const secret = process.env.BUILDWISE_JOBS_SECRET;
  if (!secret) return { ok: false, error: 'BUILDWISE_JOBS_SECRET is not configured on the platform.' };

  // Never run past the caller's own deadline: being killed mid-call leaves no run
  // row at all (silent disappearance), which is worse than a recorded timeout.
  const budgetMs = ctx.deadlineAt
    ? Math.min(BUILDWISE_JOB_TIMEOUT_MS, ctx.deadlineAt - Date.now())
    : BUILDWISE_JOB_TIMEOUT_MS;
  if (budgetMs < BUILDWISE_MIN_CALL_MS) {
    return { ok: false, error: 'Not enough time left in this dispatcher run to call BuildWise; deferred to the next tick.' };
  }

  let res: Response;
  try {
    res = await fetch(target.url, {
      method: 'POST',
      headers: { 'x-jobs-secret': secret },
      cache: 'no-store',
      // A 3xx must never carry the secret header onward to a host we didn't vet.
      redirect: 'error',
      signal: AbortSignal.timeout(budgetMs)
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
    // readOnly here means ONLY: this routine changes nothing in the reporter's own
    // data. It does NOT mean the run is side-effect-free at the far end.
    //
    // cash-digest / budget-watchdog / anomaly-scan call writeAlerts() in BuildWise,
    // which calls notifyAlertPush() on every new HIGH-severity row — a push
    // notification to the managing director's phone. Only buildwise.reconcile is
    // genuinely silent. Scheduling one of the first three is scheduling a message
    // to a human; treat any new buildwise.* kind the same way until proven silent.
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
