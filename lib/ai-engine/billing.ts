/**
 * Monthly AI bill per app — the arithmetic (Director's decisions, 24 Oct 2026).
 *
 *   bill = Claude API price of the app's runs that month (sum of
 *          ai_usage.api_cost_usd) minus the discount of the app's client.
 *
 *   - A run that FAILED (success = false) is never billed, even if it carries
 *     a price.
 *   - A TEST run (is_test, from the task builder's Try-it) IS billed.
 *   - A successful run with no recorded price (api_cost_usd NULL: recorded
 *     before 24 Oct 2026, or the CLI did not report one) is an "unpriced run".
 *     It is counted on its own and adds nothing; it is NOT shown as $0 cost.
 *   - An app with no client linked is billed at 0% discount.
 *   - The discount applies to the month's total, not run by run.
 *   - Months are calendar months in India time (IST, UTC+05:30).
 *   - Runs with no app (application_id NULL, e.g. the Control Tower's own
 *     account probes) get a line of their own marked not billed.
 *
 * Money is added up in whole micro-dollars (the 6 decimals ai_usage keeps), so
 * long sums do not drift. Billed USD keeps 6 decimals; INR is rounded to paise.
 *
 * Pure: no database, no clock (callers pass "now"). Unit-tested in
 * tests/ai-billing.test.ts.
 */

/**
 * ASSUMPTION, not a live rate: rupees per US dollar used to show INR next to
 * the recorded USD. Change it here; every bill and the usage page use it.
 */
export const USD_TO_INR_ASSUMED = 88;

const IST_OFFSET_MS = 330 * 60_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' check for a month key (from a URL, a form). */
export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && MONTH_RE.test(s);
}

/** The IST calendar month an instant falls in, as 'YYYY-MM'. */
export function istMonthOf(instant: string | Date): string {
  const t = (typeof instant === 'string' ? new Date(instant) : instant).getTime() + IST_OFFSET_MS;
  return new Date(t).toISOString().slice(0, 7);
}

/** The current IST month (pass the clock in). */
export function currentIstMonth(now: Date): string {
  return istMonthOf(now);
}

/** [start, end) of an IST month as UTC ISO instants, for a `gte` / `lt` query. */
export function istMonthRange(month: string): { start: string; end: string } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`not a month: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const start = Date.UTC(y, mo, 1) - IST_OFFSET_MS;
  const end = Date.UTC(y, mo + 1, 1) - IST_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** The `count` months up to and including `month`, newest first. */
export function recentMonths(month: string, count: number): string[] {
  const m = MONTH_RE.exec(month);
  if (!m) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// ── inputs ───────────────────────────────────────────────────────────────────

export interface BillUsageRow {
  application_id: string | null;
  app_slug: string;
  success: boolean;
  is_test: boolean;
  /** PostgREST returns numeric as a string. */
  api_cost_usd: number | string | null;
  invoked_at: string;
}

export interface BillApp {
  id: string;
  name: string;
  slug: string;
  billing_client_id: string | null;
}

export interface BillClient {
  myjkkn_client_id: string;
  name_cached: string;
  discount_pct: number | string;
}

// ── output ───────────────────────────────────────────────────────────────────

export interface BillLine {
  /** `${month}|app:<id>` or `${month}|slug:<app_slug>` */
  key: string;
  month: string;
  application_id: string | null;
  app_slug: string;
  app_name: string;
  /** false = runs with no app (not billed to anyone). */
  billed_to_app: boolean;
  client_id: string | null;
  /** null = "No client linked". */
  client_name: string | null;
  runs: number;
  /** succeeded and priced: these make up the bill */
  billable_runs: number;
  /** test runs among all runs (billed when they succeed) */
  test_runs: number;
  /** never billed */
  failed_runs: number;
  /** succeeded with no recorded price: not billed, not counted as $0 */
  unpriced_runs: number;
  api_usd: number;
  discount_pct: number;
  billed_usd: number;
  billed_inr: number;
}

export interface BillTotals {
  runs: number;
  billable_runs: number;
  test_runs: number;
  failed_runs: number;
  unpriced_runs: number;
  api_usd: number;
  billed_usd: number;
  billed_inr: number;
}

const toMicro = (v: number | string) => Math.round(Number(v) * 1e6);
const fromMicro = (m: number) => m / 1e6;

/** Micro-dollars after a discount of `pct` (2 decimals) off the total. */
function discounted(micro: number, pct: number): number {
  const bp = Math.round(Math.min(100, Math.max(0, pct)) * 100); // basis points
  return Math.round((micro * (10_000 - bp)) / 10_000);
}

/** Paise-rounded INR for a micro-dollar amount. */
function inrOf(micro: number, rate: number): number {
  return Math.round((micro * rate) / 1e4) / 100;
}

/** USD → INR at the assumed rate, rounded to paise. */
export function usdToInr(usd: number, rate = USD_TO_INR_ASSUMED): number {
  return inrOf(toMicro(usd), rate);
}

/**
 * Usage rows → one bill line per app per IST month.
 * `apps` / `clients` give names and the discount; an app missing from `apps`
 * is still billed (at 0%) under its slug.
 */
export function buildBillLines(
  rows: BillUsageRow[],
  apps: BillApp[],
  clients: BillClient[],
  rate = USD_TO_INR_ASSUMED
): BillLine[] {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const clientById = new Map(clients.map((c) => [c.myjkkn_client_id, c]));
  const acc = new Map<string, BillLine & { micro: number }>();

  for (const r of rows) {
    const month = istMonthOf(r.invoked_at);
    const key = r.application_id ? `${month}|app:${r.application_id}` : `${month}|slug:${r.app_slug}`;
    let line = acc.get(key);
    if (!line) {
      const app = r.application_id ? appById.get(r.application_id) : undefined;
      const client = app?.billing_client_id ? clientById.get(app.billing_client_id) : undefined;
      line = {
        key,
        month,
        application_id: r.application_id,
        app_slug: app?.slug ?? r.app_slug,
        app_name: app?.name ?? r.app_slug,
        billed_to_app: r.application_id != null,
        client_id: client?.myjkkn_client_id ?? null,
        client_name: client?.name_cached ?? null,
        runs: 0,
        billable_runs: 0,
        test_runs: 0,
        failed_runs: 0,
        unpriced_runs: 0,
        api_usd: 0,
        discount_pct: client ? Number(client.discount_pct) || 0 : 0,
        billed_usd: 0,
        billed_inr: 0,
        micro: 0
      };
      acc.set(key, line);
    }
    line.runs += 1;
    if (r.is_test) line.test_runs += 1;
    if (!r.success) line.failed_runs += 1;
    else if (r.api_cost_usd == null) line.unpriced_runs += 1;
    else {
      line.billable_runs += 1;
      line.micro += toMicro(r.api_cost_usd);
    }
  }

  const out: BillLine[] = [];
  for (const { micro, ...line } of acc.values()) {
    const billedMicro = line.billed_to_app ? discounted(micro, line.discount_pct) : 0;
    out.push({
      ...line,
      api_usd: fromMicro(micro),
      billed_usd: fromMicro(billedMicro),
      billed_inr: inrOf(billedMicro, rate)
    });
  }
  return out.sort(
    (a, b) =>
      b.month.localeCompare(a.month) ||
      Number(b.billed_to_app) - Number(a.billed_to_app) ||
      b.billed_usd - a.billed_usd ||
      a.app_name.localeCompare(b.app_name)
  );
}

/** Column totals for a set of lines (micro-dollar sums, so no drift). */
export function billTotals(lines: BillLine[], rate = USD_TO_INR_ASSUMED): BillTotals {
  let api = 0;
  let billed = 0;
  const t = { runs: 0, billable_runs: 0, test_runs: 0, failed_runs: 0, unpriced_runs: 0 };
  for (const l of lines) {
    t.runs += l.runs;
    t.billable_runs += l.billable_runs;
    t.test_runs += l.test_runs;
    t.failed_runs += l.failed_runs;
    t.unpriced_runs += l.unpriced_runs;
    api += toMicro(l.api_usd);
    billed += toMicro(l.billed_usd);
  }
  return { ...t, api_usd: fromMicro(api), billed_usd: fromMicro(billed), billed_inr: inrOf(billed, rate) };
}

// ── display ──────────────────────────────────────────────────────────────────

/** USD as recorded: 4 decimals under $1 (runs cost fractions of a cent), else 2. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
}

/** INR to the paisa, with Indian digit grouping. */
export function formatInr(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 && abs !== '0.00' ? `−₹${abs}` : `₹${abs}`;
}

/** 'YYYY-MM' → 'October 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/**
 * API price for display. When every successful run is unpriced, the price is
 * unknown, not $0: say "not priced" rather than show a zero.
 */
export function apiPriceLabel(l: { billable_runs: number; unpriced_runs: number; api_usd: number }): string {
  return l.billable_runs === 0 && l.unpriced_runs > 0 ? 'not priced' : formatUsd(l.api_usd);
}
