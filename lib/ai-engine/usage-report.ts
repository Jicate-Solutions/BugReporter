/**
 * AI usage page — the arithmetic (Director, 24 Oct 2026).
 *
 * For any slice of runs (by client, app, model, task or Claude account) over
 * a date range, five money columns:
 *
 *   API price    what the Claude API would have charged (successful runs'
 *                ai_usage.api_cost_usd), in USD and INR
 *   Actual cost  what the runs really cost us: each Claude Max account costs
 *                MAX_ACCOUNT_INR_PER_MONTH a month, shared among that
 *                account's runs in the same IST month in proportion to their
 *                API price
 *   Billed       what the apps are billed for these runs: the monthly bill
 *                function from billing.ts (API price minus the client's
 *                discount; failed runs never billed; runs with no app never)
 *   Saving       API price (INR) minus actual cost
 *
 * Allocation rules, also stated on the page:
 *   - The month's share is worked out over the account's WHOLE month (all
 *     apps, not just the slice shown or the dates picked), so a narrow view
 *     never absorbs the whole Rs 24,000.
 *   - Only successful runs with a recorded price and a recorded account get a
 *     share. Failed runs, unpriced runs and runs with no account get none.
 *   - An account with no priced runs in a month leaves its Rs 24,000 for that
 *     month unallocated (shown separately to org admins).
 *   - For the month in progress the Rs 24,000 is shared among the runs so
 *     far, so the figures move until the month ends.
 *
 * Pure: no database, no clock. Unit-tested in tests/ai-usage-report.test.ts.
 */

import {
  USD_TO_INR_ASSUMED,
  billTotals,
  buildBillLines,
  istMonthOf,
  type BillApp,
  type BillClient,
  type BillUsageRow
} from '@/lib/ai-engine/billing';

/** What one Claude Max account costs a month, in rupees. */
export const MAX_ACCOUNT_INR_PER_MONTH = 24_000;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const USAGE_DIMENSIONS = ['client', 'app', 'model', 'task', 'account'] as const;
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number];
export const DIMENSION_LABEL: Record<UsageDimension, string> = {
  client: 'Client',
  app: 'App',
  model: 'Model',
  task: 'Task',
  account: 'Claude account'
};

export interface UsageRowIn extends BillUsageRow {
  job_type: string;
  model_id: string | null;
  account: string | null;
}

// ── dates (IST) ──────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' that is a real calendar day. */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === s;
}

/** The IST calendar day an instant falls on. */
export function istDayOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start of `from`, end of `to`) in IST, as UTC ISO instants. */
export function istDayRange(from: string, to: string): { start: string; end: string } {
  const start = Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS;
  const end = Date.parse(`${to}T00:00:00Z`) + 86_400_000 - IST_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** Whole days from `from` to `to`, inclusive. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** IST months touched by the day range, oldest first. */
export function monthsTouched(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) return out;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

// ── allocation ───────────────────────────────────────────────────────────────

const toMicro = (v: number | string) => Math.round(Number(v) * 1e6);

/** Runs that get a share of an account's monthly cost. */
function sharesCost(r: UsageRowIn): boolean {
  return r.success && r.api_cost_usd != null && r.account != null;
}

const acctKey = (month: string, account: string) => `${month}|${account}`;

/**
 * Micro-dollars of API price per (IST month, account), over successful priced
 * runs. Pass every run of the whole months involved, not just the slice.
 */
export function accountMonthTotals(rows: UsageRowIn[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!sharesCost(r)) continue;
    const k = acctKey(istMonthOf(r.invoked_at), r.account!);
    out.set(k, (out.get(k) ?? 0) + toMicro(r.api_cost_usd!));
  }
  return out;
}

/** This run's share of its account's monthly cost, in rupees (not rounded). */
export function actualCostInr(r: UsageRowIn, totals: Map<string, number>): number {
  if (!sharesCost(r)) return 0;
  const total = totals.get(acctKey(istMonthOf(r.invoked_at), r.account!)) ?? 0;
  const mine = toMicro(r.api_cost_usd!);
  // A month whose priced runs all cost $0.000000 shares the cost evenly by
  // price, which is undefined; leave it unallocated rather than divide by 0.
  if (total <= 0) return 0;
  return (MAX_ACCOUNT_INR_PER_MONTH * mine) / total;
}

// ── slices ───────────────────────────────────────────────────────────────────

export interface UsageSlice {
  key: string;
  label: string;
  runs: number;
  priced_runs: number;
  unpriced_runs: number;
  failed_runs: number;
  api_usd: number;
  api_inr: number;
  actual_inr: number;
  billed_usd: number;
  billed_inr: number;
  saving_inr: number;
}

const paise = (n: number) => Math.round(n * 100) / 100;

function sliceOf(
  r: UsageRowIn,
  dim: UsageDimension,
  appById: Map<string, BillApp>,
  clientById: Map<string, BillClient>
): { key: string; label: string } {
  switch (dim) {
    case 'app': {
      if (!r.application_id) return { key: `slug:${r.app_slug}`, label: `${r.app_slug} (no app)` };
      return { key: r.application_id, label: appById.get(r.application_id)?.name ?? r.app_slug };
    }
    case 'client': {
      if (!r.application_id) return { key: 'no-app', label: 'No app (not billed)' };
      const cid = appById.get(r.application_id)?.billing_client_id;
      const c = cid ? clientById.get(cid) : undefined;
      return c ? { key: c.myjkkn_client_id, label: c.name_cached } : { key: 'none', label: 'No client linked' };
    }
    case 'model':
      return { key: r.model_id ?? '', label: r.model_id ?? 'model not recorded' };
    case 'task':
      return { key: r.job_type, label: r.job_type };
    case 'account':
      return { key: r.account ?? '', label: r.account ?? 'account not recorded' };
  }
}

/** Sum a set of rows into one slice's numbers. */
function summarise(
  key: string,
  label: string,
  rows: UsageRowIn[],
  totals: Map<string, number>,
  apps: BillApp[],
  clients: BillClient[],
  rate: number
): UsageSlice {
  let actual = 0;
  let failed = 0;
  for (const r of rows) {
    actual += actualCostInr(r, totals);
    if (!r.success) failed += 1;
  }
  // The monthly bill function, per app per month, on just these rows. Its
  // lines also carry the API price of runs with no app (billed 0).
  const lines = buildBillLines(rows, apps, clients, rate);
  const bill = billTotals(lines, rate);
  const apiMicro = lines.reduce((s, l) => s + toMicro(l.api_usd), 0);
  const api_usd = apiMicro / 1e6;
  const api_inr = Math.round((apiMicro * rate) / 1e4) / 100;
  const actual_inr = paise(actual);
  return {
    key,
    label,
    runs: rows.length,
    priced_runs: lines.reduce((s, l) => s + l.billable_runs, 0),
    unpriced_runs: lines.reduce((s, l) => s + l.unpriced_runs, 0),
    failed_runs: failed,
    api_usd,
    api_inr,
    actual_inr,
    billed_usd: bill.billed_usd,
    billed_inr: bill.billed_inr,
    saving_inr: paise(api_inr - actual_inr)
  };
}

/**
 * Runs (already cut to the date range and the viewer's scope) → one slice per
 * value of `dim`, biggest API price first, plus a total over all of them.
 * `totals` comes from accountMonthTotals over the whole months.
 */
export function buildUsageSlices(
  rows: UsageRowIn[],
  totals: Map<string, number>,
  apps: BillApp[],
  clients: BillClient[],
  dim: UsageDimension,
  rate = USD_TO_INR_ASSUMED
): { slices: UsageSlice[]; total: UsageSlice } {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const clientById = new Map(clients.map((c) => [c.myjkkn_client_id, c]));
  const groups = new Map<string, { label: string; rows: UsageRowIn[] }>();
  for (const r of rows) {
    const { key, label } = sliceOf(r, dim, appById, clientById);
    const g = groups.get(key) ?? { label, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const slices = [...groups].map(([key, g]) => summarise(key, g.label, g.rows, totals, apps, clients, rate));
  slices.sort((a, b) => b.api_usd - a.api_usd || b.runs - a.runs || a.label.localeCompare(b.label));
  return { slices, total: summarise('total', 'Total', rows, totals, apps, clients, rate) };
}

export interface AccountMonth {
  month: string;
  account: string;
  api_usd: number;
  cost_inr: number;
  /** cost left with no priced run to carry it */
  unallocated_inr: number;
}

/** Per month × known account: its cost and whether any priced run carries it. */
export function accountMonthSummary(
  totals: Map<string, number>,
  accounts: string[],
  months: string[]
): AccountMonth[] {
  const out: AccountMonth[] = [];
  for (const month of months) {
    for (const account of accounts) {
      const micro = totals.get(acctKey(month, account)) ?? 0;
      out.push({
        month,
        account,
        api_usd: micro / 1e6,
        cost_inr: MAX_ACCOUNT_INR_PER_MONTH,
        unallocated_inr: micro > 0 ? 0 : MAX_ACCOUNT_INR_PER_MONTH
      });
    }
  }
  return out;
}
