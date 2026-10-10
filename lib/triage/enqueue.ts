/**
 * Producer for the client triage lane.
 *
 * A bug gets ONE triage job when its app is a client app (data_boundary =
 * 'client') AND the app has switched triage on (settings.triage.enabled). The
 * job row lives in this database only; the Windows runner pulls it through
 * /api/internal/triage/claim.
 *
 * Modelled on enqueueWebhook (lib/webhooks/events.ts): called from the intake
 * route after the bug is stored, never throws, and never fails the intake.
 * Dedupe is the table's UNIQUE (bug_report_id, kind) — a repeat enqueue is a
 * no-op, which is what makes the backfill safe to run again.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const TRIAGE_KIND = 'triage.v1';

/** Statuses that mean "nobody needs a triage note any more". */
const CLOSED_STATUSES = ['resolved', 'closed', 'wont_fix'];

export const BACKFILL_MAX_BATCH = 50;

interface AppRow {
  data_boundary?: unknown;
  settings?: { triage?: { enabled?: unknown } } | null;
}

/** Client app with triage switched on. Both must be literally true. */
export function isTriageEligible(app: AppRow | null | undefined): boolean {
  if (!app) return false;
  return app.data_boundary === 'client' && app.settings?.triage?.enabled === true;
}

async function readApp(
  supabase: SupabaseClient,
  applicationId: string
): Promise<AppRow | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('data_boundary, settings')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) {
    console.error('[triage] could not read application for enqueue:', error.message);
    return null;
  }
  return (data as AppRow | null) ?? null;
}

/**
 * Enqueue a triage job for a newly created bug, if its app qualifies.
 * Returns whether a job is (now) queued for it. Never throws.
 */
export async function enqueueTriageForBug(
  supabase: SupabaseClient,
  args: { bugReportId: string; applicationId: string }
): Promise<boolean> {
  try {
    const app = await readApp(supabase, args.applicationId);
    if (!isTriageEligible(app)) return false;

    const { error } = await supabase.from('triage_jobs').upsert(
      {
        bug_report_id: args.bugReportId,
        application_id: args.applicationId,
        kind: TRIAGE_KIND
      },
      { onConflict: 'bug_report_id,kind', ignoreDuplicates: true }
    );
    if (error) {
      console.error('[triage] enqueue failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[triage] enqueue threw:', e instanceof Error ? e.message : e);
    return false;
  }
}

export interface BackfillResult {
  eligible: boolean;
  scanned: number;
  enqueued: number;
}

/**
 * Queue open bugs of one app that have no triage job yet, oldest first, at most
 * `limit` per call (capped at BACKFILL_MAX_BATCH). Call repeatedly until
 * `enqueued` is 0. Refuses (eligible=false) unless the app is a client app with
 * triage on — the same rule as the producer.
 */
export async function backfillTriageJobs(
  supabase: SupabaseClient,
  applicationId: string,
  limit: number = 25
): Promise<BackfillResult> {
  const batch = Math.max(1, Math.min(BACKFILL_MAX_BATCH, Math.floor(limit) || 1));
  const app = await readApp(supabase, applicationId);
  if (!isTriageEligible(app)) return { eligible: false, scanned: 0, enqueued: 0 };

  const { data: existing, error: existingErr } = await supabase
    .from('triage_jobs')
    .select('bug_report_id')
    .eq('application_id', applicationId)
    .eq('kind', TRIAGE_KIND);
  if (existingErr) throw new Error(existingErr.message);
  const already = new Set(
    ((existing ?? []) as { bug_report_id: string }[]).map((r) => r.bug_report_id)
  );

  // Page through open bugs until a batch of un-queued ones is found.
  const PAGE = 200;
  const picked: string[] = [];
  let scanned = 0;
  for (let from = 0; picked.length < batch; from += PAGE) {
    const { data: bugs, error } = await supabase
      .from('bug_reports')
      .select('id')
      .eq('application_id', applicationId)
      .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (bugs ?? []) as { id: string }[];
    scanned += rows.length;
    for (const row of rows) {
      if (!already.has(row.id)) picked.push(row.id);
      if (picked.length >= batch) break;
    }
    if (rows.length < PAGE) break;
  }

  if (picked.length === 0) return { eligible: true, scanned, enqueued: 0 };

  const { error: insErr } = await supabase.from('triage_jobs').upsert(
    picked.map((id) => ({
      bug_report_id: id,
      application_id: applicationId,
      kind: TRIAGE_KIND
    })),
    { onConflict: 'bug_report_id,kind', ignoreDuplicates: true }
  );
  if (insErr) throw new Error(insErr.message);
  return { eligible: true, scanned, enqueued: picked.length };
}
