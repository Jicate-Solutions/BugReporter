import { describe, it, expect } from 'vitest';
import {
  USD_TO_INR_ASSUMED,
  apiPriceLabel,
  billTotals,
  buildBillLines,
  currentIstMonth,
  isMonthKey,
  istMonthOf,
  istMonthRange,
  recentMonths,
  usdToInr,
  type BillApp,
  type BillClient,
  type BillUsageRow
} from '@/lib/ai-engine/billing';
import { billScope } from '@/lib/ai-engine/bills-data';

/**
 * Guards the monthly AI bill per app (Director, 24 Oct 2026): API price minus
 * the client's discount; failed runs not billed; test runs billed; unpriced
 * runs counted on their own; months in IST.
 */

const APP_A = '11111111-1111-1111-1111-111111111111';
const APP_B = '22222222-2222-2222-2222-222222222222';
const CLIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const apps: BillApp[] = [
  { id: APP_A, name: 'Plug the Leak', slug: 'plug-the-leak', billing_client_id: CLIENT },
  { id: APP_B, name: 'LoopMind', slug: 'loopmind', billing_client_id: null }
];
const clients: BillClient[] = [{ myjkkn_client_id: CLIENT, name_cached: 'Acme Ltd', discount_pct: '12.50' }];

function row(p: Partial<BillUsageRow>): BillUsageRow {
  return {
    application_id: APP_A,
    app_slug: 'plug-the-leak',
    success: true,
    is_test: false,
    api_cost_usd: '0.010000',
    invoked_at: '2026-10-10T06:00:00Z',
    ...p
  };
}

describe('IST months', () => {
  it('puts an instant in its India-time month', () => {
    expect(istMonthOf('2026-09-30T18:29:59Z')).toBe('2026-09');
    expect(istMonthOf('2026-09-30T18:30:00Z')).toBe('2026-10');
    expect(istMonthOf('2026-10-31T18:29:59Z')).toBe('2026-10');
    expect(istMonthOf('2026-10-31T18:30:00Z')).toBe('2026-11');
  });

  it('gives the UTC range of an IST month', () => {
    expect(istMonthRange('2026-10')).toEqual({
      start: '2026-09-30T18:30:00.000Z',
      end: '2026-10-31T18:30:00.000Z'
    });
    expect(istMonthRange('2026-12').end).toBe('2026-12-31T18:30:00.000Z');
    expect(() => istMonthRange('2026-13')).toThrow();
  });

  it('takes the current month from India time, not UTC', () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India.
    expect(currentIstMonth(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11');
    expect(currentIstMonth(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10');
  });

  it('lists recent months across a year end and checks month keys', () => {
    expect(recentMonths('2027-01', 3)).toEqual(['2027-01', '2026-12', '2026-11']);
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });
});

describe('buildBillLines', () => {
  it('excludes failed runs from the bill even when they carry a price', () => {
    const [l] = buildBillLines(
      [row({}), row({ success: false, api_cost_usd: '5.000000' })],
      apps,
      []
    );
    expect(l.runs).toBe(2);
    expect(l.failed_runs).toBe(1);
    expect(l.billable_runs).toBe(1);
    expect(l.api_usd).toBe(0.01);
  });

  it('bills test runs', () => {
    const [l] = buildBillLines([row({ is_test: true, application_id: APP_B, app_slug: 'loopmind' })], apps, clients);
    expect(l.test_runs).toBe(1);
    expect(l.billable_runs).toBe(1);
    expect(l.billed_usd).toBe(0.01);
  });

  it('counts a run with no price as unpriced, not as $0', () => {
    const [l] = buildBillLines(
      [row({ api_cost_usd: null }), row({ api_cost_usd: '0.000000' })],
      apps,
      []
    );
    expect(l.unpriced_runs).toBe(1);
    expect(l.billable_runs).toBe(1); // the recorded zero is a real price
    expect(l.api_usd).toBe(0);
  });

  it('applies the client discount to the month total, rounded to 6 decimals', () => {
    const lines = buildBillLines(
      [row({ api_cost_usd: '0.071035' }), row({ api_cost_usd: '0.071036' })],
      apps,
      clients
    );
    const [l] = lines;
    expect(l.client_name).toBe('Acme Ltd');
    expect(l.discount_pct).toBe(12.5);
    expect(l.api_usd).toBe(0.142071);
    // 0.142071 × 0.875 = 0.124312125 → 0.124312
    expect(l.billed_usd).toBe(0.124312);
    expect(l.billed_inr).toBe(Math.round(0.124312 * USD_TO_INR_ASSUMED * 100) / 100);
  });

  it('rounds half up at the sixth decimal', () => {
    const c = [{ ...clients[0], discount_pct: 50 }];
    const [l] = buildBillLines([row({ api_cost_usd: '0.000003' })], apps, c);
    expect(l.billed_usd).toBe(0.000002); // 0.0000015 → 0.000002
  });

  it('bills an app with no client at 0% and says so', () => {
    const [l] = buildBillLines([row({ application_id: APP_B, app_slug: 'loopmind' })], apps, clients);
    expect(l.client_name).toBeNull();
    expect(l.discount_pct).toBe(0);
    expect(l.billed_usd).toBe(l.api_usd);
  });

  it('a 100% discount bills nothing; an out-of-range discount is clamped', () => {
    const [free] = buildBillLines([row({})], apps, [{ ...clients[0], discount_pct: 100 }]);
    expect(free.billed_usd).toBe(0);
    const [over] = buildBillLines([row({})], apps, [{ ...clients[0], discount_pct: 140 }]);
    expect(over.billed_usd).toBe(0);
  });

  it('splits lines by IST month at the boundary', () => {
    const lines = buildBillLines(
      [
        row({ invoked_at: '2026-09-30T18:29:59Z' }),
        row({ invoked_at: '2026-09-30T18:30:00Z' }),
        row({ invoked_at: '2026-10-31T18:30:00Z' })
      ],
      apps,
      []
    );
    expect(lines.map((l) => [l.month, l.runs])).toEqual([
      ['2026-11', 1],
      ['2026-10', 1],
      ['2026-09', 1]
    ]);
  });

  it('gives runs with no app their own line, not billed', () => {
    const lines = buildBillLines(
      [
        row({ application_id: null, app_slug: 'control-tower', api_cost_usd: '0.002000' }),
        row({ application_id: null, app_slug: 'control-tower', api_cost_usd: null }),
        row({})
      ],
      apps,
      clients
    );
    const tower = lines.find((l) => l.app_slug === 'control-tower')!;
    expect(tower.billed_to_app).toBe(false);
    expect(tower.api_usd).toBe(0.002);
    expect(tower.unpriced_runs).toBe(1);
    expect(tower.billed_usd).toBe(0);
    expect(lines[0].billed_to_app).toBe(true); // app lines sort first
  });

  it('adds many small prices without floating-point drift', () => {
    const rows = Array.from({ length: 1000 }, () => row({ api_cost_usd: '0.000100' }));
    const [l] = buildBillLines(rows, apps, []);
    expect(l.api_usd).toBe(0.1);
  });
});

describe('billTotals and INR', () => {
  it('sums lines and converts at the assumed rate', () => {
    const lines = buildBillLines(
      [row({}), row({ application_id: APP_B, app_slug: 'loopmind', api_cost_usd: '0.020000' }), row({ success: false })],
      apps,
      clients
    );
    const t = billTotals(lines);
    expect(t.runs).toBe(3);
    expect(t.failed_runs).toBe(1);
    expect(t.api_usd).toBe(0.03);
    expect(t.billed_usd).toBe(0.02875); // 0.01 × 0.875 + 0.02
    expect(t.billed_inr).toBe(usdToInr(0.02875));
  });

  it('rounds INR to paise', () => {
    expect(usdToInr(1, 88)).toBe(88);
    expect(usdToInr(0.123456, 88)).toBe(10.86);
  });
});

describe('billScope (who sees which bills)', () => {
  const ORG = '00000000-0000-0000-0000-000000000000';
  const actor = (p: Partial<import('@/lib/ai-engine/task-builder').Actor>) => ({
    userId: 'u',
    superAdmin: false,
    orgRoles: new Map<string, string>(),
    appRoles: new Map<string, string>(),
    ...p
  });

  it('org owner, org admin and super admin see every app and the runs with no app', () => {
    for (const a of [
      actor({ orgRoles: new Map([[ORG, 'owner']]) }),
      actor({ orgRoles: new Map([[ORG, 'admin']]) }),
      actor({ superAdmin: true })
    ]) {
      const s = billScope(a, ORG, apps);
      expect(s.orgAdmin).toBe(true);
      expect(s.apps.map((x) => x.id)).toEqual([APP_A, APP_B]);
    }
  });

  it('an app team member sees only their own app, never another', () => {
    const s = billScope(actor({ appRoles: new Map([[APP_B, 'viewer']]) }), ORG, apps);
    expect(s.orgAdmin).toBe(false);
    expect(s.apps.map((x) => x.id)).toEqual([APP_B]);
  });

  it('an org developer with no app membership sees nothing', () => {
    const s = billScope(actor({ orgRoles: new Map([[ORG, 'developer']]) }), ORG, apps);
    expect(s.orgAdmin).toBe(false);
    expect(s.apps).toEqual([]);
  });

  it('an admin of a different organisation is not an admin here', () => {
    const s = billScope(actor({ orgRoles: new Map([['other-org', 'owner']]) }), ORG, apps);
    expect(s.orgAdmin).toBe(false);
    expect(s.apps).toEqual([]);
  });
});

describe('apiPriceLabel', () => {
  it('says "not priced" when every successful run lacks a price, never $0', () => {
    expect(apiPriceLabel({ billable_runs: 0, unpriced_runs: 8, api_usd: 0 })).toBe('not priced');
    expect(apiPriceLabel({ billable_runs: 0, unpriced_runs: 0, api_usd: 0 })).toBe('$0.00');
    expect(apiPriceLabel({ billable_runs: 58, unpriced_runs: 54, api_usd: 0.142071 })).toBe('$0.1421');
  });
});
