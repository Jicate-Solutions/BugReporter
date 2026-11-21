import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dayAgoLine,
  disagreeLine,
  forecast,
  paceLines,
  paceOver,
  readAccountHistory,
  recordReadingHistory,
  repeatsLastReading,
  thisWeek,
  unexplainedFall,
  weekPace,
  HISTORY_WINDOW_MS,
  FULL_WITHIN_THE_HOUR,
  NO_FRESH_READING,
  NOT_ENOUGH,
  NOT_RISING,
  type CurrentReading,
  type HistoryRow,
  type WeekReading
} from '@/lib/ai-engine/account-pace';

/**
 * Pace and forecast under each account's bars (Director, 21 Nov 2026). The
 * card kept only the latest reading, so it could not say whether an account at
 * 74% lasts until its week resets. Readings are now kept in a history table;
 * these are the sums made from it, and the two database helpers around it.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

// Saturday 21 Nov 2026, 11:30 am in India.
const NOW = Date.parse('2026-11-21T06:00:00Z');
// Wednesday 25 Nov 2026, 5:30 pm in India.
const RESET = '2026-11-25T12:00:00Z';
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const row = (msAgo: number, week: number | null, resets: string | null = RESET): WeekReading => ({
  seven_day_util: week,
  seven_day_resets_at: resets,
  read_at: ago(msAgo)
});

/** The account's own latest reading, as its ai_accounts row holds it. */
const account = (week: number | null, readAgo = 10 * MIN, over: Partial<CurrentReading> = {}): CurrentReading => ({
  five_hour_util: null,
  five_hour_resets_at: null,
  seven_day_util: week,
  seven_day_resets_at: RESET,
  updated_at: ago(readAgo),
  ...over
});

describe("thisWeek: which readings count", () => {
  it('leaves out a reading whose weekly reset time has passed: it belongs to the old week', () => {
    const lastWeek = '2026-11-20T12:00:00Z';
    const points = thisWeek([row(20 * HOUR, 0.96, lastWeek), row(2 * HOUR, 0.03), row(10 * MIN, 0.05)], NOW);
    expect(points.map((p) => p.u)).toEqual([0.03, 0.05]);
  });

  it('a fall in the number means a reset happened: only the readings after it count', () => {
    // No reset time on these rows, so only the fall can tell.
    const points = thisWeek([row(5 * HOUR, 0.9, null), row(3 * HOUR, 0.05, null), row(10 * MIN, 0.08, null)], NOW);
    expect(points.map((p) => p.u)).toEqual([0.05, 0.08]);
  });

  it('a 1-point dip is two sources rounding differently, not a reset', () => {
    const points = thisWeek([row(2 * HOUR, 0.74), row(1 * HOUR, 0.75), row(10 * MIN, 0.74)], NOW);
    expect(points).toHaveLength(3);
  });

  it('puts the readings in time order and drops one with no weekly number', () => {
    const points = thisWeek([row(10 * MIN, 0.5), row(3 * HOUR, 0.4), row(1 * HOUR, null)], NOW);
    expect(points.map((p) => p.u)).toEqual([0.4, 0.5]);
  });
});

describe('paceOver and weekPace: points of the week gained per hour', () => {
  it('measures from the reading at the start of the window to the latest reading', () => {
    // 6 points in the 3 hours between the reading 3 h 10 min old and the one 10 min old.
    const points = thisWeek([row(3 * HOUR + 10 * MIN, 0.4), row(HOUR, 0.44), row(10 * MIN, 0.46)], NOW);
    const pace = paceOver(points, 3 * HOUR, NOW);
    expect(pace?.perHour).toBeCloseTo(2, 9);
    expect(pace?.wholeWindow).toBe(true);
  });

  it('gives the 3-hour and the 24-hour pace side by side', () => {
    const points = thisWeek(
      [row(24 * HOUR + 10 * MIN, 0.26), row(3 * HOUR + 10 * MIN, 0.47), row(10 * MIN, 0.5)],
      NOW
    );
    const pace = weekPace(points, NOW);
    expect(pace.last24h?.perHour).toBeCloseTo(1, 9);
    expect(pace.last3h?.perHour).toBeCloseTo(1, 9);
    expect([pace.last24h?.wholeWindow, pace.last3h?.wholeWindow]).toEqual([true, true]);
  });

  it('says so when the readings do not reach back over the whole window', () => {
    const points = thisWeek([row(2 * HOUR, 0.7), row(HOUR, 0.71), row(0, 0.72)], NOW);
    expect(paceOver(points, 24 * HOUR, NOW)?.perHour).toBeCloseTo(1, 9);
    expect(paceOver(points, 24 * HOUR, NOW)?.wholeWindow).toBe(false);
    expect(paceOver(points, 3 * HOUR, NOW)?.wholeWindow).toBe(false);
  });

  it('is never negative: a small dip reads as no rise', () => {
    const points = thisWeek([row(2 * HOUR, 0.75), row(10 * MIN, 0.74)], NOW);
    expect(paceOver(points, 3 * HOUR, NOW)?.perHour).toBe(0);
  });

  it('gives no pace from fewer than 2 readings at least 30 minutes apart', () => {
    expect(paceOver([], 3 * HOUR, NOW)).toBeNull();
    expect(paceOver(thisWeek([row(10 * MIN, 0.5)], NOW), 3 * HOUR, NOW)).toBeNull();
    expect(paceOver(thisWeek([row(29 * MIN, 0.5), row(0, 0.6)], NOW), 3 * HOUR, NOW)).toBeNull();
    expect(paceOver(thisWeek([row(30 * MIN, 0.5), row(0, 0.6)], NOW), 3 * HOUR, NOW)).not.toBeNull();
  });

  it('gives no pace when the latest reading is over an hour old: that is not "now"', () => {
    const points = thisWeek([row(5 * HOUR, 0.5), row(2 * HOUR, 0.6)], NOW);
    expect(paceOver(points, 24 * HOUR, NOW)).toBeNull();
  });

  it('does not take a reading from long before the window as its start', () => {
    // 10 hours old is not "3 hours ago"; the only reading inside the 3 hours stands alone.
    const points = thisWeek([row(10 * HOUR, 0.3), row(10 * MIN, 0.5)], NOW);
    expect(paceOver(points, 3 * HOUR, NOW)).toBeNull();
  });
});

describe('dayAgoLine', () => {
  it('shows the week a day ago and now, only when there is history that old', () => {
    const withDay = thisWeek([row(24 * HOUR + 30 * MIN, 0.72), row(10 * MIN, 0.74)], NOW);
    expect(dayAgoLine(withDay, NOW)).toBe('Week: 72% a day ago, 74% now.');
    expect(dayAgoLine(thisWeek([row(20 * HOUR, 0.72), row(10 * MIN, 0.74)], NOW), NOW)).toBeNull();
    expect(dayAgoLine([], NOW)).toBeNull();
  });

  it('shows nothing when the reading a day ago was in the week before', () => {
    const points = thisWeek([row(24 * HOUR + 30 * MIN, 0.97, '2026-11-20T12:00:00Z'), row(10 * MIN, 0.04)], NOW);
    expect(dayAgoLine(points, NOW)).toBeNull();
  });
});

describe('forecast: when it is full, against when it resets', () => {
  it('full before the reset, at the 24-hour pace', () => {
    // 24 points in 24 h 20 min: 21 more to reach 95%, about 21 hours on. Sunday 22 Nov, about 8:40 am in India.
    const points = thisWeek([row(24 * HOUR + 30 * MIN, 0.5), row(12 * HOUR, 0.62), row(10 * MIN, 0.74)], NOW);
    expect(forecast(points, RESET, NOW)).toBe(
      'At this pace it is full by Sun 22 Nov, 9 am, about 3 days before it resets. ' +
        "Pace: about 1% of the week's allowance each hour, from the last 24 hours."
    );
  });

  it('falls back to the 3-hour pace when there is under 24 hours of history, and says which', () => {
    // 3 points in the 3 hours up to 10 minutes ago (11:20 am): 23 more to reach 95%, 23 hours on, 10:20 am.
    const points = thisWeek([row(3 * HOUR + 10 * MIN, 0.69), row(HOUR, 0.71), row(10 * MIN, 0.72)], NOW);
    expect(forecast(points, RESET, NOW)).toBe(
      'At this pace it is full by Sun 22 Nov, 10 am, about 3 days before it resets. ' +
        "Pace: about 1% of the week's allowance each hour, from the last 3 hours."
    );
  });

  it('says "the last 2 hours" when the readings go back only that far', () => {
    const points = thisWeek([row(2 * HOUR + 5 * MIN, 0.7), row(5 * MIN, 0.72)], NOW);
    expect(forecast(points, RESET, NOW)).toBe(
      'At this pace it is full by Sun 22 Nov, 10 am, about 3 days before it resets. ' +
        "Pace: about 1% of the week's allowance each hour, from the last 2 hours."
    );
  });

  it('gives no forecast from one small step: readings move in whole points', () => {
    // Before (second review): 74% then 75% 35 minutes later read as "about 1.7% each hour,
    // from the last 3 hours" and "full by tonight", for an account gaining 2 to 3 points a day.
    // This is every account in the first hours after the history starts or the week resets.
    expect(forecast(thisWeek([row(35 * MIN, 0.74), row(0, 0.75)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(35 * MIN, 0.44), row(0, 0.45)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(90 * MIN, 0.74), row(45 * MIN, 0.74), row(0, 0.75)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    // Just short of 2 hours is still too little; 2 hours is enough.
    expect(forecast(thisWeek([row(119 * MIN, 0.74), row(0, 0.75)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(120 * MIN, 0.74), row(0, 0.75)], NOW), RESET, NOW)).toContain('from the last 2 hours');
    // The same right after a weekly reset: only the new week's readings count.
    const afterReset = thisWeek([row(5 * HOUR, 0.9), row(3 * HOUR, 0.91), row(40 * MIN, 0.01), row(0, 0.02)], NOW);
    expect(forecast(afterReset, RESET, NOW)).toBe(NOT_ENOUGH);
  });

  it('says the reading is not fresh, not that there are too few, when the latest one is over an hour old', () => {
    // Before: "Not enough readings yet" under a full day of readings whose latest was 70 minutes old.
    const stale = thisWeek([row(24 * HOUR + 30 * MIN, 0.2), row(12 * HOUR, 0.35), row(70 * MIN, 0.5)], NOW);
    expect(forecast(stale, RESET, NOW)).toBe(NO_FRESH_READING);
    expect(forecast(thisWeek([row(5 * HOUR, 0.5), row(2 * HOUR, 0.6)], NOW), RESET, NOW)).toBe(NO_FRESH_READING);
    // One old reading alone, or two a few minutes apart, really is "not enough".
    expect(forecast(thisWeek([row(70 * MIN, 0.5)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(80 * MIN, 0.5), row(70 * MIN, 0.5)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    // A fresh reading with only a much older one before it: still not enough to judge a pace (pinned).
    expect(forecast(thisWeek([row(5 * HOUR, 0.5), row(10 * MIN, 0.6)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
  });

  it('never names a time that has passed: "within the hour"', () => {
    // 94% read 50 minutes ago at 1 point an hour: full 10 minutes from now. Before: "full by Sat 21 Nov, 11 am"
    // on a clock that already read 11:30.
    const soon = thisWeek([row(3 * HOUR + 50 * MIN, 0.91), row(50 * MIN, 0.94)], NOW);
    expect(forecast(soon, RESET, NOW)).toBe(
      `${FULL_WITHIN_THE_HOUR} Pace: about 1% of the week's allowance each hour, from the last 3 hours.`
    );
    // Worked out as already past (the reading is 50 minutes old): the same words.
    const past = thisWeek([row(3 * HOUR + 50 * MIN, 0.88), row(50 * MIN, 0.945)], NOW);
    expect(forecast(past, RESET, NOW)).toContain(FULL_WITHIN_THE_HOUR);
    // An hour or more away is a time on the clock again.
    const later = thisWeek([row(3 * HOUR + 10 * MIN, 0.9), row(10 * MIN, 0.93)], NOW);
    expect(forecast(later, RESET, NOW)).toContain('full by Sat 21 Nov, 1 pm');
    // The week resets first: that is what the line says.
    const resetsIn5 = new Date(NOW + 5 * MIN).toISOString();
    expect(forecast(soon, resetsIn5, NOW)).toContain('it lasts until it resets on Sat 21 Nov, 11:35 am');
  });

  it('lasts until it resets when the pace is slow', () => {
    const points = thisWeek([row(24 * HOUR + 30 * MIN, 0.4), row(10 * MIN, 0.42)], NOW);
    expect(forecast(points, RESET, NOW)).toBe(
      'At this pace it lasts until it resets on Wed 25 Nov, 5:30 pm. ' +
        "Pace: under 0.1% of the week's allowance each hour, from the last 24 hours."
    );
  });

  it('says "not rising" when the number has not moved', () => {
    const points = thisWeek([row(24 * HOUR + 30 * MIN, 0.74), row(12 * HOUR, 0.74), row(10 * MIN, 0.74)], NOW);
    expect(forecast(points, RESET, NOW)).toBe(NOT_RISING);
  });

  it('says there are not enough readings, never a made-up pace', () => {
    expect(forecast([], RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(10 * MIN, 0.5)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
    expect(forecast(thisWeek([row(20 * MIN, 0.5), row(0, 0.6)], NOW), RESET, NOW)).toBe(NOT_ENOUGH);
  });

  it('counts hours, not days, when it fills up close to the reset', () => {
    // Resets Sunday 22 Nov, 2:30 pm in India; full by about 10 am: four and a half hours before, written as about 5.
    const points = thisWeek(
      [row(3 * HOUR + 10 * MIN, 0.69, '2026-11-22T09:00:00Z'), row(10 * MIN, 0.72, '2026-11-22T09:00:00Z')],
      NOW
    );
    expect(forecast(points, '2026-11-22T09:00:00Z', NOW)).toContain('full by Sun 22 Nov, 10 am, about 5 hours before it resets.');
  });
});

describe('paceLines: what the card shows under the bars', () => {
  it('one line for the last 24 hours and one for the forecast', () => {
    const lines = paceLines(account(0.74), [row(24 * HOUR + 30 * MIN, 0.5), row(12 * HOUR, 0.62)], NOW);
    expect(lines).toEqual([
      'Week: 50% a day ago, 74% now.',
      "At this pace it is full by Sun 22 Nov, 9 am, about 3 days before it resets. Pace: about 1% of the week's allowance each hour, from the last 24 hours."
    ]);
  });

  it('"now" is the number on the bar: the account\'s own latest reading, also when the history is behind', () => {
    // The history stops 40 minutes ago at 73%; the account row says 74%, read 10 minutes ago.
    const lines = paceLines(account(0.74), [row(24 * HOUR + 30 * MIN, 0.72), row(40 * MIN, 0.73)], NOW);
    expect(lines[0]).toBe('Week: 72% a day ago, 74% now.');
  });

  it('only the forecast line when there is no reading a day old', () => {
    const lines = paceLines(account(0.72, 5 * MIN), [row(3 * HOUR + 10 * MIN, 0.69), row(HOUR, 0.71)], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('from the last 3 hours');
  });

  it('a day of readings whose latest is old: the day line, then "no fresh reading"', () => {
    const lines = paceLines(account(0.5, 70 * MIN), [row(24 * HOUR + 30 * MIN, 0.2), row(12 * HOUR, 0.35)], NOW);
    expect(lines).toEqual(['Week: 20% a day ago, 50% now.', NO_FRESH_READING]);
  });

  it('works with no history at all (the history table is not there yet, or is empty)', () => {
    expect(paceLines(account(0.74), [], NOW)).toEqual([NOT_ENOUGH]);
    expect(paceLines(account(null, 10 * MIN, { updated_at: null }), [], NOW)).toEqual([NOT_ENOUGH]);
  });

  it('shows nothing at all for a full account, whichever window is full', () => {
    const history = [row(24 * HOUR + 30 * MIN, 0.5), row(12 * HOUR, 0.62)];
    expect(paceLines(account(0.96), history, NOW)).toEqual([]);
    expect(paceLines(account(1), history, NOW)).toEqual([]);
    const fiveHourFull = account(0.74, 10 * MIN, { five_hour_util: 0.97, five_hour_resets_at: new Date(NOW + HOUR).toISOString() });
    expect(paceLines(fiveHourFull, history, NOW)).toEqual([]);
  });

  it('starts again after the week renews: the old week\'s readings do not count', () => {
    // The stored reading is from the week that has ended: there is no reading of the new week yet.
    const ended = account(0.96, 6 * HOUR, { seven_day_resets_at: '2026-11-21T00:00:00Z' });
    expect(paceLines(ended, [row(24 * HOUR + 30 * MIN, 0.9, '2026-11-21T00:00:00Z')], NOW)).toEqual([NOT_ENOUGH]);
  });

  it('never names who used the allowance', () => {
    const text = paceLines(account(0.74), [row(24 * HOUR + 30 * MIN, 0.5), row(12 * HOUR, 0.62)], NOW).join(' ');
    expect(text).not.toMatch(/unexplained|used by|worker|box|lane|desk|token|api|util|probe/i);
  });
});

/**
 * Seen on 21 Nov 2026: one account read 71% of its week at 7:40 am and 29% at
 * 8:20 am, with the same weekly reset time on both readings. A real reset
 * moves the reset time a week on, so this was no reset: one of the two
 * readings was wrong. The card must say so, not turn it into a pace.
 */
describe('the readings disagree: a big fall with no weekly reset', () => {
  const SENTENCE = 'The readings fell from 71% to 29% with no weekly reset, so the pace is not known today.';

  it('finds the fall of 21 Nov and says it in one plain sentence', () => {
    const history = [row(3 * HOUR, 0.71), row(2 * HOUR + 20 * MIN, 0.29)];
    const fall = unexplainedFall(history, NOW);
    expect(fall).toEqual({ from: 0.71, to: 0.29, at: NOW - (2 * HOUR + 20 * MIN) });
    expect(disagreeLine(fall!)).toBe(SENTENCE);
  });

  it('the card then shows that sentence alone: no day-ago line, no pace, no forecast', () => {
    const history = [row(25 * HOUR, 0.6), row(3 * HOUR, 0.71), row(2 * HOUR + 20 * MIN, 0.29), row(HOUR, 0.31)];
    expect(paceLines(account(0.33), history, NOW)).toEqual([SENTENCE]);
    // In any order, as the page hands it over.
    expect(paceLines(account(0.33), [...history].reverse(), NOW)).toEqual([SENTENCE]);
  });

  it('does not turn the number climbing back into "full within the hour"', () => {
    const history = [row(3 * HOUR, 0.71), row(2 * HOUR + 20 * MIN, 0.29), row(HOUR, 0.7)];
    const lines = paceLines(account(0.72), history, NOW);
    expect(lines).toEqual([SENTENCE]);
    expect(lines.join(' ')).not.toContain('At this pace');
  });

  it('sees the fall when the newest reading is the low one (the reading on the bar)', () => {
    expect(paceLines(account(0.29, 5 * MIN), [row(45 * MIN, 0.71)], NOW)).toEqual([SENTENCE]);
  });

  it('a real weekly reset is not a disagreement: the reset time moved on', () => {
    // The old week's reset time has passed; the new reading carries next week's.
    const passed = new Date(NOW - HOUR).toISOString();
    expect(unexplainedFall([row(2 * HOUR, 0.9, passed), row(30 * MIN, 0.02)], NOW)).toBeNull();
    // Reset early by Claude: both times are still ahead, but they differ.
    expect(unexplainedFall([row(2 * HOUR, 0.9, '2026-11-22T12:00:00Z'), row(30 * MIN, 0.02)], NOW)).toBeNull();
    expect(paceLines(account(0.02, 30 * MIN), [row(2 * HOUR, 0.9, '2026-11-22T12:00:00Z')], NOW)).toEqual([NOT_ENOUGH]);
  });

  it('reset times a few seconds apart are the same reset', () => {
    const nearly = '2026-11-25T12:00:05Z';
    expect(unexplainedFall([row(2 * HOUR, 0.71, nearly), row(HOUR, 0.29)], NOW)).not.toBeNull();
  });

  it('needs a fall of 5 points: 4 points is left to the usual rule', () => {
    expect(unexplainedFall([row(2 * HOUR, 0.5), row(HOUR, 0.46)], NOW)).toBeNull();
    expect(unexplainedFall([row(2 * HOUR, 0.5), row(HOUR, 0.45)], NOW)).toEqual({ from: 0.5, to: 0.45, at: NOW - HOUR });
  });

  it('holds for 24 hours after the fall, then the usual lines come back', () => {
    expect(unexplainedFall([row(24 * HOUR - MIN, 0.71), row(23 * HOUR + 50 * MIN, 0.29)], NOW)).not.toBeNull();
    const old = [row(25 * HOUR + 30 * MIN, 0.71), row(24 * HOUR + 30 * MIN, 0.29), row(12 * HOUR, 0.31)];
    expect(unexplainedFall(old, NOW)).toBeNull();
    expect(paceLines(account(0.33), old, NOW).join(' ')).not.toContain('The readings fell');
  });

  it('names the newest fall when there are two', () => {
    const history = [row(6 * HOUR, 0.8), row(5 * HOUR, 0.6), row(3 * HOUR, 0.71), row(2 * HOUR, 0.29)];
    expect(unexplainedFall(history, NOW)).toEqual({ from: 0.71, to: 0.29, at: NOW - 2 * HOUR });
  });

  it('a reading with no reset time, or no weekly number, proves nothing', () => {
    expect(unexplainedFall([row(2 * HOUR, 0.71, null), row(HOUR, 0.29, null)], NOW)).toBeNull();
    expect(unexplainedFall([row(2 * HOUR, 0.71), row(HOUR, null)], NOW)).toBeNull();
    expect(unexplainedFall([], NOW)).toBeNull();
  });

  it('a full account still shows nothing', () => {
    expect(paceLines(account(0.96), [row(2 * HOUR, 0.99), row(HOUR, 0.5)], NOW)).toEqual([]);
  });

  it('the sentence names no user', () => {
    expect(SENTENCE).not.toMatch(/unexplained|used by|worker|box|lane|desk|token|api|util|probe/i);
  });
});

// ── the history table ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Fake = {
  rows: Row[];
  inserted: Row[];
  /** label → since, for each read made. */
  reads: { label: unknown; since?: string }[];
  readError?: { code?: string; message: string };
  insertError?: { code?: string; message: string };
  throws?: boolean;
};

function fakeAdmin(f: Fake): SupabaseClient {
  return {
    from: (table: string) => {
      if (f.throws) throw new Error('connection lost');
      expect(table).toBe('ai_account_readings');
      const read: { label: unknown; since?: string } = { label: undefined };
      let lim = Infinity;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: unknown) => ((read.label = v), b),
        gte: (_c: string, v: string) => ((read.since = v), b),
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        insert: async (row: Row) => {
          if (f.insertError) return { error: f.insertError };
          f.inserted.push(row);
          f.rows.push(row);
          return { error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          f.reads.push(read);
          const rows = f.rows
            .filter((r) => r.label === read.label && (!read.since || String(r.read_at) >= read.since))
            .sort((a, b2) => (String(a.read_at) < String(b2.read_at) ? 1 : -1))
            .slice(0, lim);
          return Promise.resolve(f.readError ? { data: null, error: f.readError } : { data: rows, error: null }).then(res, rej);
        }
      };
      return b;
    }
  } as unknown as SupabaseClient;
}

const db = (over: Partial<Fake> = {}): Fake => ({ rows: [], inserted: [], reads: [], ...over });

const reading = (msAgo: number, over: Partial<HistoryRow> = {}): HistoryRow => ({
  label: 'aiahs',
  five_hour_util: 0.2,
  seven_day_util: 0.74,
  five_hour_resets_at: new Date(NOW + HOUR).toISOString(),
  seven_day_resets_at: RESET,
  reported_by: 'jicate-3',
  read_at: ago(msAgo),
  ...over
});

afterEach(() => vi.restoreAllMocks());

describe('repeatsLastReading: keeping the history small', () => {
  const last = { five_hour_util: 0.2, seven_day_util: 0.74, read_at: ago(9 * MIN) };

  it('the same weekly and 5-hour values within 10 minutes are a repeat', () => {
    expect(repeatsLastReading(last, reading(0))).toBe(true);
  });

  it('not a repeat once 10 minutes have passed, or when either value moved', () => {
    expect(repeatsLastReading({ ...last, read_at: ago(10 * MIN) }, reading(0))).toBe(false);
    expect(repeatsLastReading(last, reading(0, { seven_day_util: 0.75 }))).toBe(false);
    expect(repeatsLastReading(last, reading(0, { five_hour_util: 0.21 }))).toBe(false);
  });

  it('the first reading of an account is never a repeat', () => {
    expect(repeatsLastReading(null, reading(0))).toBe(false);
  });

  it('"no value" and 0 are different values; a number stored as text still matches', () => {
    expect(repeatsLastReading({ ...last, five_hour_util: null }, reading(0, { five_hour_util: 0 }))).toBe(false);
    expect(repeatsLastReading({ ...last, five_hour_util: null }, reading(0, { five_hour_util: null }))).toBe(true);
    expect(repeatsLastReading({ ...last, seven_day_util: '0.74', five_hour_util: '0.20' }, reading(0))).toBe(true);
  });
});

describe('recordReadingHistory', () => {
  it('adds the reading as one row', async () => {
    const f = db();
    await recordReadingHistory(fakeAdmin(f), reading(0));
    expect(f.inserted).toEqual([reading(0)]);
  });

  it('skips a repeat of the same account, and still adds one for another account', async () => {
    const f = db({ rows: [reading(5 * MIN)] });
    await recordReadingHistory(fakeAdmin(f), reading(0));
    expect(f.inserted).toEqual([]);
    await recordReadingHistory(fakeAdmin(f), reading(0, { label: 'aiece' }));
    expect(f.inserted.map((r) => r.label)).toEqual(['aiece']);
  });

  it('adds it again after 10 minutes, so a flat stretch still has readings to measure from', async () => {
    const f = db({ rows: [reading(11 * MIN)] });
    await recordReadingHistory(fakeAdmin(f), reading(0));
    expect(f.inserted).toHaveLength(1);
  });

  it('never throws and stays quiet while the history table does not exist yet', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = { code: 'PGRST205', message: 'Could not find the table' };
    await expect(recordReadingHistory(fakeAdmin(db({ readError: missing })), reading(0))).resolves.toBeUndefined();
    await expect(recordReadingHistory(fakeAdmin(db({ insertError: { code: '42P01', message: 'no table' } })), reading(0))).resolves.toBeUndefined();
    expect(logged).not.toHaveBeenCalled();
  });

  it('never throws on any other failure either, and the logs say so', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordReadingHistory(fakeAdmin(db({ readError: { message: 'down' } })), reading(0))).resolves.toBeUndefined();
    await expect(recordReadingHistory(fakeAdmin(db({ insertError: { message: 'down' } })), reading(0))).resolves.toBeUndefined();
    await expect(recordReadingHistory(fakeAdmin(db({ throws: true })), reading(0))).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(3);
  });
});

describe('readAccountHistory (for the card)', () => {
  it('reads each account by itself, the last 26 hours only', async () => {
    const f = db({
      rows: [reading(30 * HOUR), reading(25 * HOUR), reading(HOUR), reading(HOUR, { label: 'aiece', seven_day_util: 0.44 })]
    });
    const out = await readAccountHistory(fakeAdmin(f), ['aiahs', 'aiece', 'aimech'], NOW);
    expect(out.get('aiahs')).toHaveLength(2);
    expect(out.get('aiece')?.[0].seven_day_util).toBe(0.44);
    expect(out.get('aimech')).toEqual([]);
    expect(f.reads.map((r) => r.label).sort()).toEqual(['aiahs', 'aiece', 'aimech']);
    expect(f.reads[0].since).toBe(new Date(NOW - HISTORY_WINDOW_MS).toISOString());
  });

  it('gives "no history" when the table does not exist yet, cannot be read, or the read throws', async () => {
    const missing = { code: 'PGRST205', message: 'Could not find the table' };
    for (const broken of [db({ readError: missing }), db({ readError: { message: 'down' } }), db({ throws: true })]) {
      const out = await readAccountHistory(fakeAdmin(broken), ['aiahs', 'aiece'], NOW);
      expect(out.get('aiahs')).toEqual([]);
      expect(out.get('aiece')).toEqual([]);
    }
    // The card then says so in plain words, and nothing else on the page changes.
    expect(paceLines(account(0.74), [], NOW)).toEqual([NOT_ENOUGH]);
  });
});
