import { describe, it, expect } from 'vitest';
import {
  MAX_ACCOUNT_INR_PER_MONTH,
  accountMonthSummary,
  accountMonthTotals,
  actualCostInr,
  buildUsageSlices,
  daysInclusive,
  isDayKey,
  istDayOf,
  istDayRange,
  monthsTouched,
  type UsageRowIn
} from '@/lib/ai-engine/usage-report';
import { USD_TO_INR_ASSUMED, type BillApp, type BillClient } from '@/lib/ai-engine/billing';

/**
 * Guards the AI usage page (Director, 24 Oct 2026): actual cost = Rs 24,000
 * per Claude Max account per month, shared among that account's runs in the
 * month by API price; saving = API price (INR) − actual cost; billed reuses
 * the monthly bill function.
 */

const APP_A = '11111111-1111-1111-1111-111111111111';
const APP_B = '22222222-2222-2222-2222-222222222222';
const CLIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const apps: BillApp[] = [
  { id: APP_A, name: 'Plug the Leak', slug: 'plug-the-leak', billing_client_id: CLIENT },
  { id: APP_B, name: 'LoopMind', slug: 'loopmind', billing_client_id: null }
];
const clients: BillClient[] = [{ myjkkn_client_id: CLIENT, name_cached: 'Acme Ltd', discount_pct: 50 }];

function row(p: Partial<UsageRowIn>): UsageRowIn {
  return {
    application_id: APP_A,
    app_slug: 'plug-the-leak',
    success: true,
    is_test: false,
    api_cost_usd: '1.000000',
    invoked_at: '2026-10-10T06:00:00Z',
    job_type: 'leak.coach',
    model_id: 'claude-sonnet-5-5',
    account: 'aimech',
    ...p
  };
}

describe('IST day ranges', () => {
  it('checks real calendar days', () => {
    expect(isDayKey('2026-10-31')).toBe(true);
    expect(isDayKey('2026-11-31')).toBe(false);
    expect(isDayKey('2026-1-01')).toBe(false);
  });

  it('turns IST days into UTC instants and back', () => {
    expect(istDayRange('2026-10-01', '2026-10-31')).toEqual({
      start: '2026-09-30T18:30:00.000Z',
      end: '2026-10-31T18:30:00.000Z'
    });
    expect(istDayOf(new Date('2026-10-24T19:00:00Z'))).toBe('2026-10-25');
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('lists the months a range touches, across a year end', () => {
    expect(monthsTouched('2026-11-20', '2027-01-05')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(monthsTouched('2026-10-01', '2026-10-25')).toEqual(['2026-10']);
  });
});

describe('actual cost allocation', () => {
  it('shares Rs 24,000 among one account’s runs by API price', () => {
    const rows = [row({ api_cost_usd: '3.000000' }), row({ api_cost_usd: '1.000000' })];
    const totals = accountMonthTotals(rows);
    expect(actualCostInr(rows[0], totals)).toBe(18_000);
    expect(actualCostInr(rows[1], totals)).toBe(6_000);
  });

  it('keeps accounts and months apart', () => {
    const rows = [
      row({ account: 'aimech' }),
      row({ account: 'aiahs' }),
      row({ invoked_at: '2026-09-30T18:29:59Z' }) // still September in IST
    ];
    const totals = accountMonthTotals(rows);
    for (const r of rows) expect(actualCostInr(r, totals)).toBe(MAX_ACCOUNT_INR_PER_MONTH);
  });

  it('gives no share to failed, unpriced or account-less runs', () => {
    const rows = [
      row({}),
      row({ success: false, api_cost_usd: '5.000000' }),
      row({ api_cost_usd: null }),
      row({ account: null })
    ];
    const totals = accountMonthTotals(rows);
    expect(rows.map((r) => actualCostInr(r, totals))).toEqual([24_000, 0, 0, 0]);
  });

  it('works the share out over the whole month, not the slice', () => {
    // Two apps on one account. The page for app A alone must show A's share,
    // not the whole Rs 24,000.
    const all = [row({ api_cost_usd: '1.000000' }), row({ application_id: APP_B, app_slug: 'loopmind', api_cost_usd: '3.000000' })];
    const totals = accountMonthTotals(all);
    const { total } = buildUsageSlices([all[0]], totals, apps, clients, 'app');
    expect(total.actual_inr).toBe(6_000);
  });

  it('leaves an account with no priced runs unallocated', () => {
    const totals = accountMonthTotals([row({})]);
    expect(accountMonthSummary(totals, ['aimech', 'aiahs'], ['2026-10'])).toEqual([
      { month: '2026-10', account: 'aimech', api_usd: 1, cost_inr: 24_000, unallocated_inr: 0 },
      { month: '2026-10', account: 'aiahs', api_usd: 0, cost_inr: 24_000, unallocated_inr: 24_000 }
    ]);
  });

  it('does not divide by zero when every priced run cost $0', () => {
    const rows = [row({ api_cost_usd: '0.000000' })];
    expect(actualCostInr(rows[0], accountMonthTotals(rows))).toBe(0);
  });
});

describe('buildUsageSlices', () => {
  const rows = [
    row({ api_cost_usd: '3.000000', model_id: 'claude-opus-5', job_type: 'leak.coach' }),
    row({ application_id: APP_B, app_slug: 'loopmind', api_cost_usd: '1.000000', job_type: 'bug.summarize' }),
    row({ application_id: null, app_slug: 'control-tower', api_cost_usd: '0.000000', account: 'aimech', job_type: 'system.account_probe' }),
    row({ success: false, api_cost_usd: null })
  ];
  const totals = accountMonthTotals(rows);

  it('by app: API price, actual cost, billed (reusing the bill function) and saving', () => {
    const { slices, total } = buildUsageSlices(rows, totals, apps, clients, 'app');
    const a = slices.find((s) => s.key === APP_A)!;
    expect(a.runs).toBe(2);
    expect(a.failed_runs).toBe(1);
    expect(a.api_usd).toBe(3);
    expect(a.api_inr).toBe(3 * USD_TO_INR_ASSUMED);
    expect(a.actual_inr).toBe(18_000);
    expect(a.billed_usd).toBe(1.5); // Acme's 50% discount
    expect(a.saving_inr).toBe(3 * USD_TO_INR_ASSUMED - 18_000);
    const tower = slices.find((s) => s.key === 'slug:control-tower')!;
    expect(tower.label).toBe('control-tower (no app)');
    expect(tower.billed_usd).toBe(0);
    expect(total.runs).toBe(4);
    expect(total.actual_inr).toBe(24_000);
    expect(total.billed_usd).toBe(2.5); // 1.5 + 1 (LoopMind, no client)
  });

  it('by client, model, task and account', () => {
    expect(buildUsageSlices(rows, totals, apps, clients, 'client').slices.map((s) => s.label).sort()).toEqual(
      ['Acme Ltd', 'No app (not billed)', 'No client linked']
    );
    expect(buildUsageSlices(rows, totals, apps, clients, 'model').slices.map((s) => s.label)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5-5'
    ]);
    expect(buildUsageSlices(rows, totals, apps, clients, 'task').slices.map((s) => s.label)).toEqual([
      'leak.coach',
      'bug.summarize',
      'system.account_probe'
    ]);
    const acct = buildUsageSlices([...rows, row({ account: null, api_cost_usd: null })], totals, apps, clients, 'account');
    expect(acct.slices.map((s) => s.label)).toEqual(['aimech', 'account not recorded']);
  });

  it('the slices add up to the total', () => {
    for (const dim of ['client', 'app', 'model', 'task', 'account'] as const) {
      const { slices, total } = buildUsageSlices(rows, totals, apps, clients, dim);
      expect(slices.reduce((s, x) => s + x.runs, 0)).toBe(total.runs);
      expect(Math.round(slices.reduce((s, x) => s + x.actual_inr, 0) * 100) / 100).toBe(total.actual_inr);
      expect(Math.round(slices.reduce((s, x) => s + x.billed_usd, 0) * 1e6) / 1e6).toBe(total.billed_usd);
    }
  });
});
