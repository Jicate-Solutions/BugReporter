/**
 * "What we pay vs what we use" for the paid Claude accounts (Director, 18 Nov 2026).
 *
 * Pure maths first (tested in tests/pay-vs-use.test.ts), then one reader that
 * the page calls AFTER its platform-admin check.
 *
 * Days and months are India time (Asia/Kolkata), the same as the history
 * table's `day`.
 *
 * Average weekly use: the weekly window drops to 0 each time it renews, so a
 * plain mean of daily readings would show about half the real use. Instead:
 * split the last weeks into 7-day blocks ending today, take the highest
 * reading in each block, and average those. A block counts only if the history
 * already covered its first day, so there is no average before one full week.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PROBE_JOB_TYPE } from '@/lib/ai-engine/accounts';

/** The paid Max accounts and their fee, as the Director confirmed on 18 Nov 2026. */
export const PAID_ACCOUNTS = [
  'director',
  'aidental',
  'aiahs',
  'aicse',
  'aieee',
  'aimech',
  'aiece',
  'aiperio',
  'ainursing'
] as const;
export const MONTHLY_FEE_INR = 24_000;
/** Assumed exchange rate, not a live one. */
export const INR_PER_USD_ASSUMED = 88;
/** Default idle line; the admin can change it on the page. */
export const DEFAULT_IDLE_BELOW_PCT = 20;
/** How many 7-day blocks the average looks back over. */
export const HISTORY_WEEKS = 4;
/** ai_engine_watch row that holds the page's settings. */
export const SETTINGS_KEY = 'pay_vs_use';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' of an instant, India time. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' `n` days before `day`. */
export function dayMinus(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

/** This month in India time: when it began (UTC ISO), today's day number, days in the month. */
export function istMonth(now: number): { startIso: string; dayOfMonth: number; daysInMonth: number; label: string } {
  const d = new Date(now + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startIso = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS).toISOString();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { startIso, dayOfMonth: d.getUTCDate(), daysInMonth, label };
}

export type HistoryRow = { label: string; day: string; seven_day_util: number | string | null };

export type WeeklyAverage =
  | { kind: 'none' }
  | { kind: 'short'; firstDay: string; days: number }
  | { kind: 'avg'; pct: number; weeks: number; firstDay: string; peaksPct: number[] };

/** Average weekly use for one account from its daily rows. See the file header. */
export function weeklyAverage(rows: HistoryRow[], today: string, weeks = HISTORY_WEEKS): WeeklyAverage {
  const valid = rows
    .filter((r) => r.seven_day_util != null && Number.isFinite(Number(r.seven_day_util)) && r.day <= today)
    .map((r) => ({ day: r.day, util: Number(r.seven_day_util) }));
  if (!valid.length) return { kind: 'none' };
  const firstDay = valid.map((r) => r.day).sort()[0];
  const peaks: number[] = [];
  for (let k = 0; k < weeks; k++) {
    const end = dayMinus(today, 7 * k);
    const start = dayMinus(end, 6);
    if (start < firstDay) break; // history did not cover this whole block
    const inBlock = valid.filter((r) => r.day >= start && r.day <= end).map((r) => r.util);
    if (inBlock.length) peaks.push(Math.max(...inBlock));
  }
  if (!peaks.length) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / DAY_MS) + 1;
    return { kind: 'short', firstDay, days };
  }
  const peaksPct = peaks.map((p) => Math.round(p * 1000) / 10);
  const pct = Math.round((peaks.reduce((a, b) => a + b, 0) / peaks.length) * 1000) / 10;
  return { kind: 'avg', pct, weeks: peaks.length, firstDay, peaksPct };
}

export type IdleState = 'idle' | 'in-use' | 'unknown';

/** Under the line = idle. No average yet = unknown, never idle. */
export function idleState(avg: WeeklyAverage, idleBelowPct: number): IdleState {
  if (avg.kind !== 'avg') return 'unknown';
  return avg.pct < idleBelowPct ? 'idle' : 'in-use';
}

/** The saved idle line, or the default if it is missing or out of range. */
export function parseIdleBelowPct(value: unknown): number {
  const n = Number((value as { idle_below_pct?: unknown } | null)?.idle_below_pct);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n) : DEFAULT_IDLE_BELOW_PCT;
}

export function usdToInr(usd: number): number {
  return Math.round(usd * INR_PER_USD_ASSUMED);
}

/** The share of one month's fee used up so far this month (whole days, today counted). */
export function feeSoFar(feeInr: number, dayOfMonth: number, daysInMonth: number): number {
  return Math.round((feeInr * dayOfMonth) / daysInMonth);
}

export type LedgerRow = {
  account: string | null;
  app_slug: string;
  job_type: string;
  api_cost_usd: number | string | null;
};

export type AppUse = { app: string; jobs: number; usd: number };
export type AccountUse = { jobs: number; checkJobs: number; usd: number; apps: AppUse[] };

/**
 * Jobs and API-equivalent price per account from ledger rows. The Tower's own
 * account checks (system.account_probe) are counted apart from real work.
 * Rows with no account land under the key ''.
 */
export function summarizeLedger(rows: LedgerRow[]): Map<string, AccountUse> {
  const out = new Map<string, { jobs: number; checkJobs: number; usd: number; apps: Map<string, AppUse> }>();
  for (const r of rows) {
    const key = r.account ?? '';
    const usd = Number(r.api_cost_usd ?? 0) || 0;
    const a = out.get(key) ?? { jobs: 0, checkJobs: 0, usd: 0, apps: new Map<string, AppUse>() };
    a.jobs += 1;
    if (r.job_type === PROBE_JOB_TYPE) a.checkJobs += 1;
    a.usd += usd;
    const app = r.job_type === PROBE_JOB_TYPE ? 'account checks (Control Tower)' : r.app_slug;
    const u = a.apps.get(app) ?? { app, jobs: 0, usd: 0 };
    u.jobs += 1;
    u.usd += usd;
    a.apps.set(app, u);
    out.set(key, a);
  }
  return new Map(
    [...out.entries()].map(([k, v]) => [
      k,
      {
        jobs: v.jobs,
        checkJobs: v.checkJobs,
        usd: Math.round(v.usd * 10_000) / 10_000,
        apps: [...v.apps.values()]
          .map((x) => ({ ...x, usd: Math.round(x.usd * 10_000) / 10_000 }))
          .sort((x, y) => y.jobs - x.jobs)
      }
    ])
  );
}

export type BoxCost = { host: string; usd: number; jobs: number; days: number; reportAt: string | null };

/** A box's self-reported 7-day API price, or null if it sent none. */
export function parseBoxCost(host: string, raw: unknown, reportAt: unknown): BoxCost | null {
  const c = raw as { usd?: unknown; jobs?: unknown; days?: unknown } | null;
  const usd = Number(c?.usd);
  if (!c || !Number.isFinite(usd)) return null;
  return {
    host,
    usd,
    jobs: Number(c.jobs) || 0,
    days: Number(c.days) || 7,
    reportAt: typeof reportAt === 'string' ? reportAt : null
  };
}

export type AccountReadingLite = {
  label: string;
  seven_day_util: number | string | null;
  seven_day_resets_at: string | null;
  updated_at: string | null;
};

export type PayVsUseRow = {
  label: string;
  feeInr: number;
  /** Has a row in ai_accounts: the Tower has heard of this account. */
  connected: boolean;
  latestWeekPct: number | null;
  latestAt: string | null;
  avg: WeeklyAverage;
  idle: IdleState;
  use: AccountUse;
};

const NO_USE: AccountUse = { jobs: 0, checkJobs: 0, usd: 0, apps: [] };

/** One row per paid account, joined from the latest reading, the history and the ledger. */
export function buildRows(input: {
  readings: AccountReadingLite[];
  history: HistoryRow[];
  ledger: Map<string, AccountUse>;
  idleBelowPct: number;
  now: number;
}): PayVsUseRow[] {
  const today = istDay(input.now);
  const byLabel = new Map(input.readings.map((r) => [r.label, r]));
  return PAID_ACCOUNTS.map((label) => {
    const r = byLabel.get(label);
    const renewed = r?.seven_day_resets_at != null && Date.parse(r.seven_day_resets_at) <= input.now;
    const latest = r?.seven_day_util == null || renewed ? null : Math.round(Number(r.seven_day_util) * 100);
    const avg = weeklyAverage(
      input.history.filter((h) => h.label === label),
      today
    );
    return {
      label,
      feeInr: MONTHLY_FEE_INR,
      connected: Boolean(r),
      latestWeekPct: latest,
      latestAt: r?.updated_at ?? null,
      avg,
      idle: idleState(avg, input.idleBelowPct),
      use: input.ledger.get(label) ?? NO_USE
    };
  });
}

// ---- reader (server only; the caller has already checked platform admin) ----

export type PayVsUseData = {
  rows: PayVsUseRow[];
  idleBelowPct: number;
  /** false = the history table is not there yet (migration not applied). */
  historyReady: boolean;
  ledgerTotal: AccountUse;
  /** Ledger jobs this month with no account recorded. */
  unassigned: AccountUse;
  /** Ledger jobs on accounts outside the paid list (for example "default"). */
  otherAccounts: { label: string; use: AccountUse }[];
  boxes: BoxCost[];
  month: ReturnType<typeof istMonth>;
  ledgerCapped: boolean;
};

const PAGE = 1000;
const MAX_PAGES = 60;

export async function readPayVsUse(admin: SupabaseClient, now: number): Promise<PayVsUseData> {
  const month = istMonth(now);
  const since = dayMinus(istDay(now), 7 * HISTORY_WEEKS);

  const readLedger = async () => {
    const rows: LedgerRow[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const { data, error } = await admin
        .from('ai_usage')
        .select('account, app_slug, job_type, api_cost_usd')
        .gte('invoked_at', month.startIso)
        .order('id')
        .range(p * PAGE, p * PAGE + PAGE - 1);
      if (error) throw new Error(`ai_usage: ${error.message}`);
      rows.push(...((data ?? []) as LedgerRow[]));
      if (!data || data.length < PAGE) return { rows, capped: false };
    }
    return { rows, capped: true };
  };

  const [accountsRes, historyRes, settingsRes, boxesRes, ledger] = await Promise.all([
    admin.from('ai_accounts').select('label, seven_day_util, seven_day_resets_at, updated_at'),
    admin.from('ai_account_usage_daily').select('label, day, seven_day_util').gte('day', since).limit(PAGE),
    admin.from('ai_engine_watch').select('value').eq('key', SETTINGS_KEY).maybeSingle(),
    admin.from('ai_boxes').select('host, api_cost_7d:status_report->api_cost_7d, report_at:status_report->>at'),
    readLedger()
  ]);

  const idleBelowPct = parseIdleBelowPct(settingsRes.data?.value ?? null);
  const historyReady = !historyRes.error;
  const history = historyReady ? ((historyRes.data ?? []) as HistoryRow[]) : [];
  const summary = summarizeLedger(ledger.rows);
  const paid = new Set<string>(PAID_ACCOUNTS);
  const total = summarizeLedger(ledger.rows.map((r) => ({ ...r, account: 'all' }))).get('all') ?? NO_USE;

  return {
    rows: buildRows({
      readings: (accountsRes.data ?? []) as AccountReadingLite[],
      history,
      ledger: summary,
      idleBelowPct,
      now
    }),
    idleBelowPct,
    historyReady,
    ledgerTotal: total,
    unassigned: summary.get('') ?? NO_USE,
    otherAccounts: [...summary.entries()]
      .filter(([k]) => k !== '' && !paid.has(k))
      .map(([label, use]) => ({ label, use })),
    boxes: ((boxesRes.data ?? []) as { host: string; api_cost_7d: unknown; report_at: unknown }[])
      .map((b) => parseBoxCost(b.host, b.api_cost_7d, b.report_at))
      .filter((b): b is BoxCost => b != null),
    month,
    ledgerCapped: ledger.capped
  };
}
