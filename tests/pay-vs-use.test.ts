import { describe, it, expect } from 'vitest';
import {
  DEFAULT_IDLE_BELOW_PCT,
  MONTHLY_FEE_INR,
  PAID_ACCOUNTS,
  buildRows,
  dayMinus,
  feeSoFar,
  idleState,
  istDay,
  istMonth,
  parseBoxCost,
  parseIdleBelowPct,
  summarizeLedger,
  usdToInr,
  weeklyAverage,
  type HistoryRow
} from '@/lib/ai-engine/pay-vs-use';
import { historyArgs } from '@/lib/ai-engine/usage-history';

/**
 * The pay-vs-use page must never invent an average: no history says so, a
 * short history says when it started, and the average uses each week's
 * highest reading (the weekly window drops to 0 when it renews).
 */

// 18 Nov 2026, 23:00 IST = 17:30 UTC.
const NOW = Date.parse('2026-11-18T17:30:00Z');
const TODAY = '2026-11-18';

/** One row per day from `from` (days before today) to today, each at `util`. */
const days = (label: string, from: number, util: (i: number) => number | null): HistoryRow[] =>
  Array.from({ length: from + 1 }, (_, i) => ({ label, day: dayMinus(TODAY, from - i), seven_day_util: util(i) }));

describe('India-time days and months', () => {
  it('rolls to the next day at midnight IST, not UTC', () => {
    expect(istDay(Date.parse('2026-11-18T18:29:00Z'))).toBe('2026-11-18');
    expect(istDay(Date.parse('2026-11-18T18:31:00Z'))).toBe('2026-11-19');
  });
  it('knows the month start, day number and length', () => {
    const m = istMonth(NOW);
    expect(m.startIso).toBe('2026-10-31T18:30:00.000Z');
    expect(m.dayOfMonth).toBe(18);
    expect(m.daysInMonth).toBe(30);
  });
});

describe('weeklyAverage', () => {
  it('no rows: none, never a made-up number', () => {
    expect(weeklyAverage([], TODAY)).toEqual({ kind: 'none' });
  });

  it('rows with no reading count as no history', () => {
    expect(weeklyAverage(days('a', 10, () => null), TODAY)).toEqual({ kind: 'none' });
  });

  it('under one full week: says when history started and how many days', () => {
    const r = weeklyAverage(days('a', 3, () => 0.5), TODAY);
    expect(r).toEqual({ kind: 'short', firstDay: '2026-11-15', days: 4 });
  });

  it('exactly one full week gives an average from that week', () => {
    const r = weeklyAverage(days('a', 6, (i) => i / 10), TODAY);
    expect(r.kind).toBe('avg');
    if (r.kind === 'avg') {
      expect(r.weeks).toBe(1);
      expect(r.pct).toBe(60);
    }
  });

  it('uses the highest reading per week, so a renewal to 0 does not halve the use', () => {
    // Each week climbs 0 -> 0.6 and renews; a plain mean would be about 30%.
    const rows = days('a', 27, (i) => (i % 7) / 10);
    const r = weeklyAverage(rows, TODAY);
    expect(r.kind).toBe('avg');
    if (r.kind === 'avg') {
      expect(r.weeks).toBe(4);
      expect(r.peaksPct).toEqual([60, 60, 60, 60]);
      expect(r.pct).toBe(60);
    }
  });

  it('ignores a partly covered older week', () => {
    // 10 days of history: one full week, the older 3 days do not make a second week.
    const rows = days('a', 9, (i) => (i < 3 ? 0.9 : 0.1));
    const r = weeklyAverage(rows, TODAY);
    expect(r.kind).toBe('avg');
    if (r.kind === 'avg') {
      expect(r.weeks).toBe(1);
      expect(r.pct).toBe(10);
    }
  });

  it('averages different weeks and accepts numeric strings from the database', () => {
    const rows: HistoryRow[] = [
      { label: 'a', day: dayMinus(TODAY, 13), seven_day_util: '0.40' },
      { label: 'a', day: dayMinus(TODAY, 8), seven_day_util: '0.80' },
      { label: 'a', day: dayMinus(TODAY, 2), seven_day_util: '0.10' }
    ];
    const r = weeklyAverage(rows, TODAY);
    expect(r).toMatchObject({ kind: 'avg', weeks: 2, peaksPct: [10, 80], pct: 45 });
  });
});

describe('idle flag', () => {
  const avg = (pct: number) => ({ kind: 'avg' as const, pct, weeks: 4, firstDay: '2026-10-01', peaksPct: [pct] });
  it('under the line is idle, at or above is in use', () => {
    expect(idleState(avg(19.9), 20)).toBe('idle');
    expect(idleState(avg(20), 20)).toBe('in-use');
  });
  it('follows the admin knob', () => {
    expect(idleState(avg(30), 50)).toBe('idle');
  });
  it('no history or a short one is unknown, never idle', () => {
    expect(idleState({ kind: 'none' }, 20)).toBe('unknown');
    expect(idleState({ kind: 'short', firstDay: TODAY, days: 1 }, 20)).toBe('unknown');
  });
  it('reads the saved line, falling back to 20 when missing or out of range', () => {
    expect(parseIdleBelowPct({ idle_below_pct: 35 })).toBe(35);
    expect(parseIdleBelowPct(null)).toBe(DEFAULT_IDLE_BELOW_PCT);
    expect(parseIdleBelowPct({ idle_below_pct: 0 })).toBe(20);
    expect(parseIdleBelowPct({ idle_below_pct: 150 })).toBe(20);
    expect(parseIdleBelowPct({ idle_below_pct: 'x' })).toBe(20);
  });
});

describe('cost maths', () => {
  it('nine accounts at Rs 24,000 is Rs 2,16,000 a month', () => {
    expect(PAID_ACCOUNTS.length).toBe(9);
    expect(MONTHLY_FEE_INR * PAID_ACCOUNTS.length).toBe(216_000);
  });
  it('dollars to rupees at the assumed Rs 88', () => {
    expect(usdToInr(1)).toBe(88);
    expect(usdToInr(280.1948)).toBe(24_657);
    expect(usdToInr(0)).toBe(0);
  });
  it('fee so far this month counts today', () => {
    expect(feeSoFar(24_000, 18, 30)).toBe(14_400);
    expect(feeSoFar(216_000, 30, 30)).toBe(216_000);
  });
});

describe('summarizeLedger', () => {
  it('counts jobs and price per account, account checks apart', () => {
    const m = summarizeLedger([
      { account: 'aimech', app_slug: 'control-tower', job_type: 'system.account_probe', api_cost_usd: '0.0002' },
      { account: 'aimech', app_slug: 'kenavo', job_type: 'x', api_cost_usd: 0.1 },
      { account: 'aimech', app_slug: 'kenavo', job_type: 'x', api_cost_usd: null },
      { account: null, app_slug: 'loopmind', job_type: 'y', api_cost_usd: 0.5 }
    ]);
    const a = m.get('aimech')!;
    expect(a.jobs).toBe(3);
    expect(a.checkJobs).toBe(1);
    expect(a.usd).toBeCloseTo(0.1002, 4);
    expect(a.apps[0]).toEqual({ app: 'kenavo', jobs: 2, usd: 0.1 });
    expect(a.apps[1].app).toBe('account checks (Control Tower)');
    expect(m.get('')!.jobs).toBe(1);
  });
});

describe('buildRows', () => {
  it('lists all nine paid accounts; an unread one is not connected and not idle', () => {
    const rows = buildRows({
      readings: [{ label: 'aimech', seven_day_util: '0.04', seven_day_resets_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-18T17:00:00Z' }],
      history: days('aimech', 13, () => 0.05),
      ledger: new Map(),
      idleBelowPct: 20,
      now: NOW
    });
    expect(rows.map((r) => r.label)).toEqual([...PAID_ACCOUNTS]);
    const mech = rows.find((r) => r.label === 'aimech')!;
    expect(mech).toMatchObject({ connected: true, latestWeekPct: 4, idle: 'idle' });
    const dir = rows.find((r) => r.label === 'director')!;
    expect(dir).toMatchObject({ connected: false, latestWeekPct: null, idle: 'unknown', avg: { kind: 'none' } });
    expect(dir.use.jobs).toBe(0);
  });
  it('a renewed week shows no current reading instead of the old one', () => {
    const rows = buildRows({
      readings: [{ label: 'ainursing', seven_day_util: '0.96', seven_day_resets_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-14T01:20:00Z' }],
      history: [],
      ledger: new Map(),
      idleBelowPct: 20,
      now: NOW
    });
    expect(rows.find((r) => r.label === 'ainursing')!.latestWeekPct).toBeNull();
  });
});

describe('parseBoxCost', () => {
  it('reads a box report and refuses a missing one', () => {
    expect(parseBoxCost('Biometric', { usd: 280.19, jobs: 13325, days: 7, files: 3 }, '2026-11-18T17:19:00Z')).toEqual({
      host: 'Biometric',
      usd: 280.19,
      jobs: 13325,
      days: 7,
      reportAt: '2026-11-18T17:19:00Z'
    });
    expect(parseBoxCost('x', null, null)).toBeNull();
    expect(parseBoxCost('x', { usd: 'n/a' }, null)).toBeNull();
  });
});

describe('history writer', () => {
  it('skips "default", "auto" and empty readings', () => {
    expect(historyArgs('default', 0.5, 0.1)).toBeNull();
    expect(historyArgs('auto', 0.5, 0.1)).toBeNull();
    expect(historyArgs('aimech', null, undefined)).toBeNull();
  });
  it('keeps a missing 5-hour number as null (the database keeps the stored one)', () => {
    expect(historyArgs('aimech', 0.3, undefined)).toEqual({ p_label: 'aimech', p_seven: 0.3, p_five: null });
  });
  it('drops nonsense numbers', () => {
    expect(historyArgs('aimech', -1, Number.NaN)).toBeNull();
  });
});
