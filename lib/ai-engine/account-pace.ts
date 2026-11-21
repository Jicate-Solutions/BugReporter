/**
 * How fast a Claude account's week is being used, for the accounts card.
 *
 * Why (Director, 21 Nov 2026): the card showed only the latest reading, so it
 * could not say whether an account at 74% would last until its week resets.
 * Every reading the Control Tower stores is now also kept in a history table
 * (ai_account_readings); from it the card works out a pace and a forecast.
 *
 * What this does NOT say: who used the allowance. The Control Tower does not
 * record the big users yet (Box 1's MyJKKN lanes, the Mac's desks), so nothing
 * here names a user or flags use as unexplained.
 *
 * The words, pinned so they can be tested:
 * - "This week's readings": a reading whose weekly reset time has passed
 *   belongs to the old week and is left out. A fall of 2 points or more means
 *   the week reset: only the readings after the last such fall count. (A fall
 *   of 1 point is taken as two sources rounding differently, not a reset.)
 * - "Pace over the last N hours": from the newest reading that is N hours old
 *   (up to an hour older) to the latest reading, in points of the week per
 *   hour. When no reading is that old, from the oldest reading inside the N
 *   hours, and the pace is marked as not covering the whole window. Never
 *   negative. No pace when the two readings are under 30 minutes apart, or the
 *   latest reading is over an hour old.
 * - "A day of history": a reading between 24 and 25 hours old, in this week.
 *   That same reading is the "a day ago" number.
 * - "A forecast": only from a pace measured over 2 hours or more. Readings
 *   move in whole points, so one 1-point step in half an hour would read as
 *   "full by tonight". With less than that the card says there are not enough
 *   readings yet. This holds for the first 2 hours after the history starts
 *   and after each weekly reset.
 *
 * The functions down to `paceLines` are pure. The two at the end touch the
 * database and never throw.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { windowState } from '@/lib/ai-engine/accounts';
import { istDateTime, nearestIstHour } from '@/lib/ai-engine/india-time';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** "auto" treats an account as full from here (FULL in lib/ai-engine/accounts.ts). */
const FULL = 0.95;
/** A fall of this much or more between two readings means the week reset. */
const RESET_FALL = 0.015;
/** Two readings closer than this say nothing about the pace. */
const MIN_SPAN_MS = 30 * MIN;
/** The latest reading must be this recent for a pace to be about "now". */
const LATEST_MAX_AGE_MS = HOUR;
/** A forecast needs a pace measured over at least this long (see the top of the file). */
const MIN_FORECAST_HOURS = 2;
/** How much older than the window a starting reading may be. */
const EDGE_MS = HOUR;
/** The page reads this much history: the 24-hour window plus its edge, plus an hour to spare. */
export const HISTORY_WINDOW_MS = 26 * HOUR;
/** A reading with the same values as the newest stored one is not stored again within this long. */
export const SAME_READING_MS = 10 * MIN;

export const NOT_ENOUGH = 'Not enough readings yet to judge the pace.';
export const NOT_RISING = 'Not rising now.';
export const NO_FRESH_READING = 'No fresh reading in the last hour, so the pace is not known.';
export const FULL_WITHIN_THE_HOUR = 'At this pace it is full within the hour.';

/** One stored reading, as far as the pace needs it. */
export type WeekReading = {
  seven_day_util: number | string | null;
  seven_day_resets_at: string | null;
  read_at: string;
};

/** The account's latest reading (its ai_accounts row). */
export type CurrentReading = {
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  updated_at: string | null;
};

type Point = { t: number; u: number };
export type Pace = {
  /** Points of the week gained per hour. Never negative. */
  perHour: number;
  /** True when the readings reach back over the whole window. */
  wholeWindow: boolean;
  /** How many hours lie between the two readings the pace was measured from. */
  hours: number;
};

/** This week's readings, oldest first (see the top of the file). */
export function thisWeek(rows: WeekReading[], now: number): Point[] {
  const points = rows
    .filter((r) => r.seven_day_util != null)
    .filter((r) => !(r.seven_day_resets_at && new Date(r.seven_day_resets_at).getTime() <= now))
    .map((r) => ({ t: new Date(r.read_at).getTime(), u: Number(r.seven_day_util) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.u))
    .sort((a, b) => a.t - b.t);
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].u <= points[i - 1].u - RESET_FALL) start = i;
  }
  return points.slice(start);
}

/** The newest reading that is `windowMs` old, up to an hour older: where that window starts. */
function startOfWindow(points: Point[], windowMs: number, now: number): Point | undefined {
  const start = now - windowMs;
  return [...points].reverse().find((p) => p.t <= start && p.t >= start - EDGE_MS);
}

/** The pace over the last `windowMs`, or null when the readings cannot tell (see the top of the file). */
export function paceOver(points: Point[], windowMs: number, now: number): Pace | null {
  const last = points[points.length - 1];
  if (!last || now - last.t > LATEST_MAX_AGE_MS) return null;
  const before = startOfWindow(points, windowMs, now);
  const base = before ?? points.find((p) => p.t > now - windowMs);
  if (!base || last.t - base.t < MIN_SPAN_MS) return null;
  const gained = Math.max(0, (last.u - base.u) * 100);
  const hours = (last.t - base.t) / HOUR;
  return { perHour: gained / hours, wholeWindow: Boolean(before), hours };
}

/** Points of the week gained per hour, over the last 3 hours and the last 24 hours. */
export function weekPace(points: Point[], now: number): { last3h: Pace | null; last24h: Pace | null } {
  return { last3h: paceOver(points, 3 * HOUR, now), last24h: paceOver(points, 24 * HOUR, now) };
}

const pct = (u: number) => Math.round(u * 100);

/** "Week: 72% a day ago, 74% now." Only when this week has a reading a day old. */
export function dayAgoLine(points: Point[], now: number): string | null {
  const last = points[points.length - 1];
  const dayAgo = startOfWindow(points, 24 * HOUR, now);
  if (!last || !dayAgo || dayAgo === last) return null;
  return `Week: ${pct(dayAgo.u)}% a day ago, ${pct(last.u)}% now.`;
}

/** "about 3 days", "about 5 hours", "under an hour". */
function about(ms: number): string {
  const hours = ms / HOUR;
  if (hours < 1) return 'under an hour';
  if (hours < 36) return Math.round(hours) === 1 ? 'about an hour' : `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
}

/** "about 0.4%", "about 2%", "under 0.1%". */
function rate(perHour: number): string {
  return perHour < 0.1 ? 'under 0.1%' : `about ${Math.round(perHour * 10) / 10}%`;
}

/**
 * When the account reaches 95% at its present pace, against when its week
 * resets, in one or two plain sentences. The 24-hour pace is used when there
 * is a day of history, else the 3-hour pace, and the sentence says how far
 * back the readings behind it really go.
 * - Latest reading over an hour old (with readings to measure from): says so,
 *   in place of a pace that is no longer about "now".
 * - No pace measured over 2 hours or more: not enough readings yet.
 */
export function forecast(points: Point[], weekResetsAt: string | null, now: number): string {
  const last = points[points.length - 1];
  if (!last) return NOT_ENOUGH;
  if (now - last.t > LATEST_MAX_AGE_MS) {
    return last.t - points[0].t >= MIN_SPAN_MS ? NO_FRESH_READING : NOT_ENOUGH;
  }
  const { last3h, last24h } = weekPace(points, now);
  const useDay = Boolean(last24h?.wholeWindow);
  const pace = useDay ? last24h : last3h;
  if (!pace || pace.hours < MIN_FORECAST_HOURS) return NOT_ENOUGH;
  if (pace.perHour <= 0) return NOT_RISING;

  // The 3-hour pace may rest on a little under 3 hours of readings: say 2 when it is nearer 2.
  const span = useDay ? 24 : pace.wholeWindow ? 3 : Math.round(pace.hours);
  const paceWords = `Pace: ${rate(pace.perHour)} of the week's allowance each hour, from the last ${span} hours.`;
  const exact = last.t + ((FULL - last.u) * 100 * HOUR) / pace.perHour;
  const resets = weekResetsAt ? new Date(weekResetsAt).getTime() : null;
  const resetAhead = resets != null && resets > now ? resets : null;
  // Counted from the latest reading, so the time can be almost now, or just past: never name such a time.
  if (exact - now < HOUR && (resetAhead == null || exact < resetAhead)) return `${FULL_WITHIN_THE_HOUR} ${paceWords}`;
  // To the nearest hour: a forecast is not exact to the minute.
  const fullAt = nearestIstHour(exact);
  if (resetAhead == null) return `At this pace it is full by ${istDateTime(fullAt)}. ${paceWords}`;
  if (fullAt < resetAhead) {
    return `At this pace it is full by ${istDateTime(fullAt)}, ${about(resetAhead - fullAt)} before it resets. ${paceWords}`;
  }
  return `At this pace it lasts until it resets on ${istDateTime(resetAhead)}. ${paceWords}`;
}

/**
 * The one or two small lines under an account's bars. Nothing for an account
 * that reads full: its forecast would only repeat "full". (An account whose
 * key is rejected or blocked shows no bars, so the page never asks for it.)
 * `history` = the stored readings of the last 26 hours, in any order; the
 * account's own latest reading is added, so "now" is the number on the bar.
 */
export function paceLines(account: CurrentReading, history: WeekReading[], now: number): string[] {
  const full =
    windowState(account.five_hour_util, account.five_hour_resets_at, now) === 'full' ||
    windowState(account.seven_day_util, account.seven_day_resets_at, now) === 'full';
  if (full) return [];
  const latest: WeekReading[] = account.updated_at
    ? [
        {
          seven_day_util: account.seven_day_util,
          seven_day_resets_at: account.seven_day_resets_at,
          read_at: account.updated_at
        }
      ]
    : [];
  const points = thisWeek([...history, ...latest], now);
  const day = dayAgoLine(points, now);
  return [...(day ? [day] : []), forecast(points, account.seven_day_resets_at, now)];
}

// ── the history table ────────────────────────────────────────────────────────

const HISTORY_TABLE = 'ai_account_readings';

/** One row of the history table. */
export type HistoryRow = {
  label: string;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  reported_by: string | null;
  /** When the usage was read (for a Mac reading: when the Mac read it, not when it was sent). */
  read_at: string;
};

const sameValue = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  a == null || b == null ? a == null && b == null : Number(a) === Number(b);

/**
 * True when `next` only repeats the newest stored reading: the same weekly and
 * 5-hour values, less than 10 minutes apart. Such a reading is not stored, to
 * keep the table small. "No value" and 0 are not the same value. Pure.
 */
export function repeatsLastReading(
  last: { five_hour_util: number | string | null; seven_day_util: number | string | null; read_at: string } | null,
  next: Pick<HistoryRow, 'five_hour_util' | 'seven_day_util' | 'read_at'>
): boolean {
  if (!last) return false;
  const apart = Math.abs(new Date(next.read_at).getTime() - new Date(last.read_at).getTime());
  return (
    apart < SAME_READING_MS &&
    sameValue(last.seven_day_util, next.seven_day_util) &&
    sameValue(last.five_hour_util, next.five_hour_util)
  );
}

/** The database's way of saying "that table is not there" (the migration is applied separately). */
const tableMissing = (code: string | undefined) => code === '42P01' || code === 'PGRST205';

/**
 * Add one reading to the history. Called right after a reading is stored, from
 * both places one arrives. NEVER throws and returns nothing: the history is an
 * extra, and a failure here must not fail the reading or the job that carried
 * it. Before the history table exists every call ends quietly here.
 */
export async function recordReadingHistory(admin: SupabaseClient, row: HistoryRow): Promise<void> {
  try {
    const { data, error } = await admin
      .from(HISTORY_TABLE)
      .select('five_hour_util, seven_day_util, read_at')
      .eq('label', row.label)
      .order('read_at', { ascending: false })
      .limit(1);
    if (error) {
      if (!tableMissing(error.code)) console.error('[ai-engine/account-pace] history not read:', error.message);
      return;
    }
    const last = ((data ?? []) as { five_hour_util: number | null; seven_day_util: number | null; read_at: string }[])[0];
    if (repeatsLastReading(last ?? null, row)) return;
    const { error: writeError } = await admin.from(HISTORY_TABLE).insert(row);
    if (writeError && !tableMissing(writeError.code)) {
      console.error('[ai-engine/account-pace] history not stored:', writeError.message);
    }
  } catch (e) {
    console.error('[ai-engine/account-pace] history not stored:', e instanceof Error ? e.message : e);
  }
}

/**
 * The last 26 hours of readings for each account, for the card. One small read
 * per account, newest first, so a busy account can never push another one's
 * day-old readings past the row limit. Any read error, the table not existing
 * yet included, gives that account no history; the card then says there are
 * not enough readings yet. Never throws.
 */
export async function readAccountHistory(
  admin: SupabaseClient,
  labels: string[],
  now: number
): Promise<Map<string, WeekReading[]>> {
  const since = new Date(now - HISTORY_WINDOW_MS).toISOString();
  const out = new Map<string, WeekReading[]>();
  await Promise.all(
    labels.map(async (label) => {
      try {
        const { data, error } = await admin
          .from(HISTORY_TABLE)
          .select('seven_day_util, seven_day_resets_at, read_at')
          .eq('label', label)
          .gte('read_at', since)
          .order('read_at', { ascending: false })
          .limit(1000);
        out.set(label, error ? [] : ((data ?? []) as WeekReading[]));
      } catch {
        out.set(label, []);
      }
    })
  );
  return out;
}
