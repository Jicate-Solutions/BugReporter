/**
 * Daily usage history writer (20261118_ai_account_usage_daily.sql).
 *
 * Called from the two places that store an account reading: /complete (probe
 * and job readings) and /usage-reading (Mac readings). The database keeps the
 * highest reading of each India-time day per account.
 *
 * Never throws and never slows the caller's answer down on failure: until the
 * migration is applied the function is missing, which is logged once per
 * server process and otherwise ignored.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

let warned = false;

/** Whether a reading should go into the history at all. Pure, for tests. */
export function historyArgs(
  label: string,
  sevenDay: number | null | undefined,
  fiveHour: number | null | undefined
): { p_label: string; p_seven: number | null; p_five: number | null } | null {
  if (!label || label === 'default' || label === 'auto') return null; // a different account on each box
  const ok = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v >= 0 ? v : null);
  const seven = ok(sevenDay);
  const five = ok(fiveHour);
  if (seven == null && five == null) return null;
  return { p_label: label, p_seven: seven, p_five: five };
}

export async function recordUsageDay(
  admin: SupabaseClient,
  label: string,
  sevenDay: number | null | undefined,
  fiveHour: number | null | undefined
): Promise<void> {
  const args = historyArgs(label, sevenDay, fiveHour);
  if (!args) return;
  try {
    const { error } = await admin.rpc('fn_ai_record_account_usage_day', args);
    if (error && !warned) {
      warned = true;
      console.warn('[ai-engine/usage-history] daily history not recorded (is the migration applied?):', error.message);
    }
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn('[ai-engine/usage-history] daily history not recorded:', e instanceof Error ? e.message : e);
    }
  }
}
