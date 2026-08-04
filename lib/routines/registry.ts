/**
 * Routine registry — the extensibility spine of the App Routines subsystem.
 *
 * Each RoutineKind declares what it does, its default cadence, and a buildInput()
 * that computes the engine payload from live data (with a service-role client, so
 * it works from a session-less cron). Adding a new capability later = one entry
 * here + its buildInput + a client renderer — no rebuild. Only READ-ONLY kinds are
 * ever auto-run (enforced by the `readOnly` invariant + the dispatcher).
 *
 * v1 seeds `app.brief`; `app.dupe-scan` and `app.new-bug-digest` land in Phase 3.
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

export interface RoutineKind {
  id: string;
  name: string;
  whatItDoes: string;
  readOnly: true; // ONLY read-only kinds are auto-runnable (safety invariant)
  defaultDaysOfWeek: number[];
  defaultMinuteOfDay: number;
  /** Engine input, or null when there's nothing to report → an "all clear" run (no engine call). */
  buildInput: (ctx: RoutineContext) => Promise<RoutineInput | null>;
}

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

export const ROUTINE_KINDS: RoutineKind[] = [APP_BRIEF];

export const getRoutineKind = (id: string): RoutineKind | undefined =>
  ROUTINE_KINDS.find((k) => k.id === id);
