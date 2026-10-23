/**
 * Choosing a Claude account — shared by the worker claim route (per job) and
 * the box agent route (per box, per minute), so both agree on one account.
 *
 * 'auto' = the lowest-priority-number account that still has allowance (both
 * windows under 95%, or already renewed); equal priority goes to the lowest
 * weekly usage; if none has allowance, the one that renews first.
 * "default" stands for the box's own sign-in.
 *
 * Test before moving (Director 2026-10-23): only an account read in the last
 * hour counts while one such account has allowance. The ai-engine-watch cron
 * keeps readings fresh with a tiny check job per stored account
 * (enqueueAccountProbes), so auto never jumps onto an account it hasn't heard
 * from. If no fresh account has allowance, the old rule applies, so a box is
 * never left without an account.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type AccountReading = {
  label: string;
  priority: number | null;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  updated_at?: string | null;
};

const FULL = 0.95;
/** A reading older than this is "not heard from"; auto skips it while a fresh one fits. */
export const FRESH_MS = 60 * 60_000;
/** The watch cron checks a stored account again once its reading is this old. */
export const PROBE_AFTER_MS = 15 * 60_000;
/** The tiny check job that reads an account's usage. Only the Control Tower enqueues it. */
export const PROBE_JOB_TYPE = 'system.account_probe';
export const PROBE_APP_SLUG = 'control-tower';

/** A reading taken before its window renewed no longer counts. */
function used(util: number | null, resets: string | null, now: number) {
  return util == null || (resets && new Date(resets).getTime() <= now) ? 0 : Number(util);
}

/** Pure choice behind pickAuto, kept apart so it can be tested. */
export function chooseAccount(readings: AccountReading[], labels: string[], now: number): string {
  const byLabel = new Map(readings.map((r) => [r.label, r]));
  const info = labels.map((l) => {
    const r = byLabel.get(l);
    const five = used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null, now);
    const week = used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null, now);
    const renews = Math.min(
      ...[r?.five_hour_resets_at, r?.seven_day_resets_at]
        .filter((t): t is string => Boolean(t))
        .map((t) => new Date(t).getTime())
        .filter((t) => t > now),
      Number.MAX_SAFE_INTEGER
    );
    const fresh = Boolean(r?.updated_at) && now - new Date(r!.updated_at as string).getTime() < FRESH_MS;
    return { l, prio: r?.priority ?? 100, five, week, ok: five < FULL && week < FULL, fresh, renews };
  });
  const order = (a: (typeof info)[number], b: (typeof info)[number]) =>
    a.prio - b.prio || a.week - b.week || a.five - b.five;
  const fresh = info.filter((a) => a.ok && a.fresh).sort(order);
  if (fresh.length) return fresh[0].l;
  const usable = info.filter((a) => a.ok).sort(order);
  if (usable.length) return usable[0].l;
  return info.sort((a, b) => a.renews - b.renews)[0].l;
}

/**
 * Stored accounts whose reading is old enough to check again. An account read
 * as full whose window has not renewed yet is skipped: checking it would only
 * hit the limit and make a worker pause.
 */
export function labelsToProbe(readings: AccountReading[], labels: string[], now: number): string[] {
  const byLabel = new Map(readings.map((r) => [r.label, r]));
  return labels.filter((l) => {
    if (l === 'default') return false; // a different account on each box
    const r = byLabel.get(l);
    if (r?.updated_at && now - new Date(r.updated_at).getTime() < PROBE_AFTER_MS) return false;
    const full =
      used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null, now) >= FULL ||
      used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null, now) >= FULL;
    return !full;
  });
}

/** Queue one check job per stored account that is due. Returns the labels queued. Never throws. */
export async function enqueueAccountProbes(admin: SupabaseClient): Promise<string[]> {
  try {
    const { data: sec } = await admin.from('ai_account_secrets').select('label');
    const labels = ((sec ?? []) as { label: string }[]).map((x) => x.label);
    if (!labels.length) return [];
    const { data } = await admin
      .from('ai_accounts')
      .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, updated_at')
      .in('label', labels);
    const due = labelsToProbe((data ?? []) as AccountReading[], labels, Date.now());
    const queued: string[] = [];
    for (const label of due) {
      const { data: out } = await admin.rpc('fn_ai_engine_enqueue', {
        p_job_type: PROBE_JOB_TYPE,
        p_application_id: null,
        p_app_slug: PROBE_APP_SLUG,
        p_organization_id: null,
        p_payload: { label },
        p_dedupe_key: `probe:${label}`,
        p_priority: 500
      });
      if ((out as { ok?: boolean } | null)?.ok) queued.push(label);
    }
    return queued;
  } catch (e) {
    console.error('[ai-engine/accounts] account checks not queued:', e instanceof Error ? e.message : e);
    return [];
  }
}

export async function pickAuto(admin: SupabaseClient, labels: string[]): Promise<string> {
  const { data } = await admin
    .from('ai_accounts')
    .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, updated_at')
    .in('label', labels);
  return chooseAccount((data ?? []) as AccountReading[], labels, Date.now());
}

/**
 * The account a whole box should use, or undefined when the box has no
 * Control Tower choice (then each worker's own setting applies).
 * Returns null for "the box's own sign-in". Records what auto resolved to.
 */
export async function resolveBoxAccount(
  admin: SupabaseClient,
  host: string | null | undefined
): Promise<string | null | undefined> {
  if (!host) return undefined;
  const { data } = await admin
    .from('ai_boxes')
    .select('account, chosen_label')
    .eq('host', host)
    .maybeSingle();
  const box = data as { account: string | null; chosen_label: string | null } | null;
  if (!box || box.account == null) return undefined;
  let label: string | null = box.account === 'default' ? null : box.account;
  if (box.account === 'auto') {
    const { data: sec } = await admin.from('ai_account_secrets').select('label');
    const labels = ['default', ...((sec ?? []) as { label: string }[]).map((x) => x.label)];
    const best = await pickAuto(admin, labels);
    label = best === 'default' ? null : best;
  }
  if ((box.chosen_label ?? null) !== label) {
    await admin.from('ai_boxes').update({ chosen_label: label, updated_at: new Date().toISOString() }).eq('host', host);
  }
  return label;
}
