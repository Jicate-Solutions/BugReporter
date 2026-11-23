/**
 * Usage readings pushed by the Director's Mac (scripts/mac-push-usage.mjs).
 *
 * The Mac already reads every Claude account's 5-hour / 7-day usage for free
 * and caches it (~/.config/obsidian/v5-quota-cache.json). Pushing that cache
 * here gives the Control Tower a fresh reading even for a FULL account, which
 * the probe job skips (checking a full account would only hit its limit). A
 * fresh reading also stops the watch cron queueing a probe for that account
 * (labelsToProbe skips anything updated in the last 15 minutes).
 *
 * It writes the same ai_accounts columns a probe reading writes (utilisation
 * 0-1, reset times, reported_by, updated_at), with three differences, all on
 * purpose:
 *   - it only UPDATES an account that already exists; it never creates one and
 *     never touches ai_account_secrets or priority;
 *   - it writes only the fields it was given, so a Mac reading with no 5-hour
 *     number never wipes the 5-hour number a probe stored;
 *   - updated_at is when the Mac READ the usage (read_at), not when it pushed,
 *     so re-pushing the same cached reading never makes it look fresher, and a
 *     newer stored reading is kept.
 *
 * A reading may also carry the subscription details the Mac knows for the
 * account signed in on it (22 Nov 2026). The plan and the start date only ever
 * fill fields that are still empty; paid extra use follows the Mac, because
 * nobody can type it: see fillSubscriptionFromMac.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ACCOUNT_LABEL } from '@/lib/ai-engine/usage';
import { dateParts, istToday } from '@/lib/ai-engine/india-time';

/** A reading older than this is not stored (the Mac re-reads every 30 minutes). */
export const MAC_READING_MAX_AGE_MS = 20 * 60_000;
/** Clock slack between the Mac and the server. */
export const MAC_CLOCK_SLACK_MS = 2 * 60_000;

/** Furthest ahead a reset time may be: the weekly window is 7 days, plus slack. */
export const MAC_RESET_MAX_AHEAD_MS = 8 * 24 * 60 * 60_000;

/** Utilisation is a share of the allowance: 0-1. */
const util = z.number().min(0).max(1);
const epoch = z.number().int().positive();
/** A reset time no more than 8 days ahead (checked against the server clock). */
const resetEpoch = epoch.refine((s) => s * 1000 <= Date.now() + MAC_RESET_MAX_AHEAD_MS, 'reset too far ahead');

/**
 * What the Mac knows about the subscription of the account signed in on it
 * (from ~/.claude.json): the plan, the day it started (a calendar day in
 * India) and whether paid extra use is on. Each part is optional. There is no
 * fee and no billing day: Claude does not report them.
 */
export const macSubscriptionSchema = z
  .object({
    plan: z
      .string()
      .max(40)
      .refine((p) => p.trim().length > 0 && p === p.trim(), 'empty or padded')
      .optional(),
    started_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => dateParts(d) !== null && d >= '2000-01-01', 'not a real date')
      .optional(),
    extra_use: z.boolean().optional()
  })
  .strict();

export type MacSubscription = z.infer<typeof macSubscriptionSchema>;

export const macReadingSchema = z
  .object({
    label: z
      .string()
      .regex(ACCOUNT_LABEL)
      .refine((l) => l !== 'default' && l !== 'auto', 'reserved'),
    seven_day_util: util,
    seven_day_resets_at: resetEpoch,
    five_hour_util: util.nullable().optional(),
    five_hour_resets_at: resetEpoch.nullable().optional(),
    /** When the Mac read the usage (epoch seconds). Required: it drives the 20-minute age check. */
    read_at: epoch,
    source: z.literal('mac'),
    subscription: macSubscriptionSchema.optional()
  })
  .refine((r) => (r.five_hour_util == null) === (r.five_hour_resets_at == null), {
    message: 'five_hour_util and five_hour_resets_at come together or not at all',
    path: ['five_hour_util']
  });

export type MacReading = z.infer<typeof macReadingSchema>;

export type MacRow = {
  seven_day_util: number;
  seven_day_resets_at: string;
  five_hour_util?: number;
  five_hour_resets_at?: string;
  reported_by: string;
  updated_at: string;
};

const iso = (s: number) => new Date(s * 1000).toISOString();

/**
 * The ai_accounts update for one Mac reading, or why it is refused.
 * Pure, so it can be tested without a database.
 */
export function macReadingRow(
  r: MacReading,
  runner: string,
  now: number
): { ok: true; row: MacRow } | { ok: false; reason: 'stale' | 'future' } {
  const readMs = r.read_at * 1000;
  if (readMs > now + MAC_CLOCK_SLACK_MS) return { ok: false, reason: 'future' };
  if (now - readMs > MAC_READING_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  const row: MacRow = {
    seven_day_util: r.seven_day_util,
    seven_day_resets_at: iso(r.seven_day_resets_at),
    reported_by: runner,
    updated_at: new Date(readMs).toISOString()
  };
  if (r.five_hour_util != null && r.five_hour_resets_at != null) {
    row.five_hour_util = r.five_hour_util;
    row.five_hour_resets_at = iso(r.five_hour_resets_at);
  }
  return { ok: true, row };
}

/** The database's way of saying "that column is not there" (the migration is applied separately). */
const columnMissing = (code: string | undefined) => code === 'PGRST204' || code === '42703';

/**
 * Bring an account's subscription fields in line with what the Mac reported.
 * The plan and the start date fill an EMPTY field only: each is one UPDATE
 * that only matches while that field is still null, so a value an admin typed
 * (or an earlier one from the feed) is never changed, and there is no
 * read-then-write gap. Paid extra use is different: nobody can type it, so
 * the feed keeps it current. Its UPDATE matches whenever the stored value is
 * not the one reported (empty, or the other one), and matches nothing when
 * they agree. The fee, the billing day and the note are never written here,
 * and neither is updated_at, so the usage reading's own guard is not
 * disturbed. A start date later than today in India is left out. NEVER throws
 * and returns nothing: this is an extra, and a failure here must not fail the
 * reading. One field failing does not stop the others. Before the columns
 * exist every call ends quietly.
 */
export async function fillSubscriptionFromMac(
  admin: SupabaseClient,
  label: string,
  s: MacSubscription | undefined,
  now: number
): Promise<void> {
  if (!s) return;
  const fills: [string, string | boolean][] = [];
  if (s.plan) fills.push(['plan_name', s.plan]);
  if (s.started_on && s.started_on <= istToday(now)) fills.push(['subscription_started_on', s.started_on]);
  if (s.extra_use != null) fills.push(['extra_usage_on', s.extra_use]);
  for (const [column, value] of fills) {
    try {
      const base = admin.from('ai_accounts').update({ [column]: value }).eq('label', label);
      // An update that matches no row (the field is already filled, or already agrees) is not an error.
      const { error } =
        typeof value === 'boolean' ? await base.not(column, 'is', value) : await base.is(column, null);
      if (error && !columnMissing(error.code)) {
        console.error(`[ai-engine/mac-usage] ${column} not filled:`, error.message);
      }
    } catch (e) {
      console.error(`[ai-engine/mac-usage] ${column} not filled:`, e instanceof Error ? e.message : e);
    }
  }
}
