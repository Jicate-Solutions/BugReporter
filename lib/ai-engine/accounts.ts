/**
 * Choosing a Claude account — shared by the worker claim route (per job) and
 * the box agent route (per box, per minute), so both agree on one account.
 *
 * 'auto' = the lowest-priority-number account that still has allowance (both
 * windows under 95%, or already renewed); equal priority goes to the lowest
 * weekly usage; if none has allowance, the one that renews first.
 * "default" stands for the box's own sign-in.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type AccountReading = {
  label: string;
  priority: number | null;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
};

const FULL = 0.95;

export async function pickAuto(admin: SupabaseClient, labels: string[]): Promise<string> {
  const { data } = await admin
    .from('ai_accounts')
    .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at')
    .in('label', labels);
  const byLabel = new Map(((data ?? []) as AccountReading[]).map((r) => [r.label, r]));
  const now = Date.now();
  // A reading taken before its window renewed no longer counts.
  const used = (util: number | null, resets: string | null) =>
    util == null || (resets && new Date(resets).getTime() <= now) ? 0 : Number(util);
  const info = labels.map((l) => {
    const r = byLabel.get(l);
    const five = used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null);
    const week = used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null);
    const renews = Math.min(
      ...[r?.five_hour_resets_at, r?.seven_day_resets_at]
        .filter((t): t is string => Boolean(t))
        .map((t) => new Date(t).getTime())
        .filter((t) => t > now),
      Number.MAX_SAFE_INTEGER
    );
    return { l, prio: r?.priority ?? 100, five, week, ok: five < FULL && week < FULL, renews };
  });
  const usable = info.filter((a) => a.ok).sort((a, b) => a.prio - b.prio || a.week - b.week || a.five - b.five);
  if (usable.length) return usable[0].l;
  return info.sort((a, b) => a.renews - b.renews)[0].l;
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
