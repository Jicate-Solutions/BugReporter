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
 */

import { z } from 'zod';
import { ACCOUNT_LABEL } from '@/lib/ai-engine/usage';

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
    source: z.literal('mac')
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
