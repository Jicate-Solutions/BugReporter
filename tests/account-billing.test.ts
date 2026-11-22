import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  nextRenewal,
  paidButUnusable,
  readSubscriptions,
  renewalLine,
  renewalsDue,
  renewalsTotalLine,
  rupees,
  subscriptionLine,
  subscriptionSchema,
  NO_SUBSCRIPTION_DETAILS,
  PAID_BUT_UNUSABLE,
  type Subscription
} from '@/lib/ai-engine/account-billing';
import { dateParts, dayMonth, daysBetween, daysInMonth, istDateTime, istToday, nearestIstHour } from '@/lib/ai-engine/india-time';

/**
 * A subscription line per account and a renewals list (Director, 21 Nov 2026).
 * Each Claude Max subscription renews by itself every month on the day it
 * started; Claude reports neither the date nor the amount, so they are typed
 * in and the dates are worked out here. Every date is a calendar day in India,
 * and "today" is passed in: no test here depends on the clock.
 */

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  plan_name: null,
  subscription_started_on: null,
  billing_day: null,
  monthly_fee_inr: null,
  extra_usage_on: null,
  billing_note: null,
  ...over
});

describe('India time', () => {
  it('today in India is already tomorrow while UTC is still on the old day', () => {
    // 6:15 pm UTC on 30 Nov is 11:45 pm in India: still the 30th.
    expect(istToday(Date.parse('2026-11-30T18:15:00Z'))).toBe('2026-11-30');
    // 6:45 pm UTC on 30 Nov is 12:15 am on 1 Dec in India.
    expect(istToday(Date.parse('2026-11-30T18:45:00Z'))).toBe('2026-12-01');
    // Exactly midnight in India.
    expect(istToday(Date.parse('2026-11-30T18:30:00Z'))).toBe('2026-12-01');
  });

  it('the new year starts five and a half hours before it does in UTC', () => {
    expect(istToday(Date.parse('2026-12-31T18:29:59Z'))).toBe('2026-12-31');
    expect(istToday(Date.parse('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });

  it('writes a moment the way the card says it', () => {
    expect(istDateTime(Date.parse('2026-11-22T08:30:00Z'))).toBe('Sun 22 Nov, 2 pm');
    expect(istDateTime(Date.parse('2026-11-25T12:00:00Z'))).toBe('Wed 25 Nov, 5:30 pm');
    expect(istDateTime(Date.parse('2026-11-24T18:30:00Z'))).toBe('Wed 25 Nov, 12 am');
    expect(istDateTime(Date.parse('2026-11-25T06:35:00Z'))).toBe('Wed 25 Nov, 12:05 pm');
    expect(istDateTime(Date.parse('2026-12-31T20:00:00Z'))).toBe('Fri 1 Jan, 1:30 am');
  });

  it('rounds to a full hour on an Indian clock, not a UTC one', () => {
    // 3:07 am UTC is 8:37 am in India: the nearest full hour there is 9 am (3:30 am UTC).
    expect(nearestIstHour(Date.parse('2026-11-22T03:07:00Z'))).toBe(Date.parse('2026-11-22T03:30:00Z'));
  });

  it('reads calendar dates as written and refuses ones that do not exist', () => {
    expect(dateParts('2024-03-05')).toEqual({ y: 2024, m: 3, d: 5 });
    expect(dateParts('2026-02-30')).toBeNull();
    expect(dateParts('2026-13-01')).toBeNull();
    expect(dateParts('5 March')).toBeNull();
    expect(dateParts(null)).toBeNull();
    expect([daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2026, 11), daysInMonth(2026, 12)]).toEqual([28, 29, 30, 31]);
    expect(dayMonth('2026-12-05')).toBe('5 Dec');
    expect(dayMonth('2024-03-05', true)).toBe('5 Mar 2024');
    expect(daysBetween('2026-12-06', '2027-01-05')).toBe(30);
    expect(daysBetween('2026-11-21', '2026-11-21')).toBe(0);
  });
});

describe('nextRenewal', () => {
  it('gives this month\'s date while it is still ahead, and next month\'s once it has passed', () => {
    expect(nextRenewal(sub({ billing_day: 25 }), '2026-11-21')).toEqual({ date: '2026-11-25', day: 25, confirmed: true });
    expect(nextRenewal(sub({ billing_day: 5 }), '2026-11-21')).toEqual({ date: '2026-12-05', day: 5, confirmed: true });
  });

  it('counts today when it renews today', () => {
    expect(nextRenewal(sub({ billing_day: 21 }), '2026-11-21')?.date).toBe('2026-11-21');
  });

  it('a subscription that started today was paid today: its first renewal is next month', () => {
    // Before (second review): "next today", and its fee counted in the 30-day total on the day it was paid.
    expect(nextRenewal(sub({ subscription_started_on: '2026-11-21' }), '2026-11-21')).toEqual({
      date: '2026-12-21',
      day: 21,
      confirmed: false
    });
    // Also when the billing day was entered as that same day.
    expect(nextRenewal(sub({ subscription_started_on: '2026-11-21', billing_day: 21 }), '2026-11-21')?.date).toBe('2026-12-21');
    // Started on the 31st: the first renewal is the last day of the shorter month after it; over the year end too.
    expect(nextRenewal(sub({ subscription_started_on: '2027-01-31' }), '2027-01-31')?.date).toBe('2027-02-28');
    expect(nextRenewal(sub({ subscription_started_on: '2026-12-31' }), '2026-12-31')?.date).toBe('2027-01-31');
    // Started on this day in an earlier month or year: today is a renewal day as before.
    expect(nextRenewal(sub({ subscription_started_on: '2026-10-21' }), '2026-11-21')?.date).toBe('2026-11-21');
    expect(nextRenewal(sub({ subscription_started_on: '2025-11-21' }), '2026-11-21')?.date).toBe('2026-11-21');
    // Started today, with another billing day entered: that day stands.
    expect(nextRenewal(sub({ subscription_started_on: '2026-11-21', billing_day: 25 }), '2026-11-21')?.date).toBe('2026-11-25');
    // The row and the renewals block say the same.
    const today = '2026-11-21';
    const startedToday = sub({ subscription_started_on: today, monthly_fee_inr: 24000 });
    expect(subscriptionLine(startedToday, today)).toBe(
      'started 21 Nov 2026 · renews on the 21st (estimated from the start date) · next 21 Dec · Rs 24,000 a month'
    );
    expect(renewalsDue([{ label: 'aiahs', ...startedToday }], today).items).toEqual([
      { label: 'aiahs', date: '2026-12-21', confirmed: false, fee: 24000 }
    ]);
  });

  it('a billing day that was entered is "confirmed"; one taken from the start date is "estimated"', () => {
    expect(nextRenewal(sub({ subscription_started_on: '2024-03-05' }), '2026-11-21')).toEqual({
      date: '2026-12-05',
      day: 5,
      confirmed: false
    });
    // The entered day wins over the start date.
    expect(nextRenewal(sub({ subscription_started_on: '2024-03-05', billing_day: 12 }), '2026-11-21')).toEqual({
      date: '2026-12-12',
      day: 12,
      confirmed: true
    });
  });

  it('month end: the 31st renews on the last day of a shorter month', () => {
    const on31 = sub({ billing_day: 31 });
    expect(nextRenewal(on31, '2026-11-10')?.date).toBe('2026-11-30');
    expect(nextRenewal(on31, '2026-11-30')?.date).toBe('2026-11-30');
    expect(nextRenewal(on31, '2026-12-01')?.date).toBe('2026-12-31');
    expect(nextRenewal(on31, '2027-02-01')?.date).toBe('2027-02-28');
    expect(nextRenewal(on31, '2028-02-10')?.date).toBe('2028-02-29');
    // It stays "the 31st": the day after a short month it is back on the 31st.
    expect(nextRenewal(on31, '2027-03-01')).toEqual({ date: '2027-03-31', day: 31, confirmed: true });
    expect(nextRenewal(sub({ billing_day: 30 }), '2027-02-28')?.date).toBe('2027-02-28');
    expect(nextRenewal(sub({ subscription_started_on: '2025-01-31' }), '2026-04-15')?.date).toBe('2026-04-30');
  });

  it('year end: after December comes January of next year', () => {
    expect(nextRenewal(sub({ billing_day: 5 }), '2026-12-21')?.date).toBe('2027-01-05');
    expect(nextRenewal(sub({ billing_day: 31 }), '2026-12-31')?.date).toBe('2026-12-31');
    expect(nextRenewal(sub({ billing_day: 30 }), '2026-12-31')?.date).toBe('2027-01-30');
    expect(nextRenewal(sub({ billing_day: 1 }), '2026-12-31')?.date).toBe('2027-01-01');
  });

  it('India time against UTC around midnight: the date goes by the day in India', () => {
    const on30 = sub({ billing_day: 30 });
    // 11:45 pm on 30 Nov in India: it renews today.
    expect(nextRenewal(on30, istToday(Date.parse('2026-11-30T18:15:00Z')))?.date).toBe('2026-11-30');
    // Half an hour later it is 1 Dec in India (UTC still says 30 Nov): the next one is 30 Dec.
    expect(nextRenewal(on30, istToday(Date.parse('2026-11-30T18:45:00Z')))?.date).toBe('2026-12-30');
    // New Year's midnight in India, still 31 Dec in UTC.
    expect(nextRenewal(sub({ billing_day: 31 }), istToday(Date.parse('2026-12-31T18:45:00Z')))?.date).toBe('2027-01-31');
  });

  it('says nothing when neither a billing day nor a start date is known', () => {
    expect(nextRenewal(sub(), '2026-11-21')).toBeNull();
    expect(nextRenewal(sub({ subscription_started_on: 'soon' }), '2026-11-21')).toBeNull();
    expect(nextRenewal(sub({ billing_day: 5 }), 'not a date')).toBeNull();
  });
});

describe('renewalsDue', () => {
  const accounts = [
    { label: 'aimech', ...sub({ billing_day: 5, monthly_fee_inr: 24000 }) },
    { label: 'aiahs', ...sub({ subscription_started_on: '2025-06-25', monthly_fee_inr: 24000 }) },
    { label: 'aiece', ...sub({ billing_day: 25 }) },
    { label: 'director', ...sub({ monthly_fee_inr: 24000 }) }
  ];

  it('lists them in date order with the total, an unknown fee listed and left out of the total', () => {
    const due = renewalsDue(accounts, '2026-11-21');
    expect(due.items).toEqual([
      { label: 'aiahs', date: '2026-11-25', confirmed: false, fee: 24000 },
      { label: 'aiece', date: '2026-11-25', confirmed: true, fee: null },
      { label: 'aimech', date: '2026-12-05', confirmed: true, fee: 24000 }
    ]);
    expect(due.total).toBe(48000);
    expect(due.feesMissing).toBe(1);
  });

  it('a start date from the Mac feed with no fee: listed as estimated, and adds nothing to the money', () => {
    const fromFeed = { label: 'aicse', ...sub({ plan_name: 'Max 20x', subscription_started_on: '2024-03-25', extra_usage_on: true }) };
    const alone = renewalsDue([fromFeed], '2026-11-21');
    expect(alone).toEqual({ items: [{ label: 'aicse', date: '2026-11-25', confirmed: false, fee: null }], total: 0, feesMissing: 1 });
    expect(renewalLine(alone.items[0], '2026-11-21')).toBe('25 Nov (estimated) · aicse · fee not entered');
    expect(renewalsTotalLine(alone)).toBe('Total: Rs 0. One account has no fee entered and is left out.');
    // Beside accounts that have a fee, the total is exactly what it was without it.
    const withIt = renewalsDue([...accounts, fromFeed], '2026-11-21');
    expect(withIt.items.map((i) => i.label)).toContain('aicse');
    expect(withIt.total).toBe(renewalsDue(accounts, '2026-11-21').total);
    expect(withIt.total).toBe(48000);
    expect(withIt.feesMissing).toBe(2);
    expect(Number.isFinite(withIt.total)).toBe(true);
  });

  it('leaves out an account with no date, whatever its fee', () => {
    expect(renewalsDue(accounts, '2026-11-21').items.map((i) => i.label)).not.toContain('director');
    expect(renewalsDue([{ label: 'director', ...sub({ monthly_fee_inr: 24000 }) }], '2026-11-21')).toEqual({
      items: [],
      total: 0,
      feesMissing: 0
    });
  });

  it('counts today and the 30th day: an account never drops off the list', () => {
    const one = [{ label: 'aimech', ...sub({ billing_day: 5, monthly_fee_inr: 24000 }) }];
    // The day it renews.
    expect(renewalsDue(one, '2026-12-05').items[0].date).toBe('2026-12-05');
    // The day after, in a 31-day month: the next one is exactly 30 days away.
    expect(daysBetween('2026-12-06', '2027-01-05')).toBe(30);
    expect(renewalsDue(one, '2026-12-06').items[0].date).toBe('2027-01-05');
  });

  it('looks only as far ahead as asked', () => {
    expect(renewalsDue(accounts, '2026-11-21', 7).items.map((i) => i.label)).toEqual(['aiahs', 'aiece']);
    expect(renewalsDue(accounts, '2026-11-21', 3).items).toEqual([]);
    expect(renewalsDue(accounts, '2026-11-21', 4).items).toHaveLength(2);
  });

  it('writes each line and the total in plain words', () => {
    const due = renewalsDue(accounts, '2026-11-21');
    expect(due.items.map((i) => renewalLine(i, '2026-11-21'))).toEqual([
      '25 Nov (estimated) · aiahs · Rs 24,000',
      '25 Nov · aiece · fee not entered',
      '5 Dec · aimech · Rs 24,000'
    ]);
    expect(renewalsTotalLine(due)).toBe('Total: Rs 48,000. One account has no fee entered and is left out.');
    expect(renewalsTotalLine({ total: 72000, feesMissing: 0 })).toBe('Total: Rs 72,000.');
    expect(renewalsTotalLine({ total: 0, feesMissing: 2 })).toBe('Total: Rs 0. 2 accounts have no fee entered and are left out.');
    // Across the new year the year is written; today says "Today".
    const jan = { label: 'aimech', date: '2027-01-05', confirmed: true, fee: 24000 };
    expect(renewalLine(jan, '2026-12-21')).toBe('5 Jan 2027 · aimech · Rs 24,000');
    expect(renewalLine(jan, '2027-01-05')).toBe('Today · aimech · Rs 24,000');
  });
});

describe('subscriptionLine', () => {
  it('writes the full line the way the Director asked for it', () => {
    const full = sub({
      plan_name: 'Max 20x',
      subscription_started_on: '2024-03-05',
      monthly_fee_inr: 24000,
      extra_usage_on: false
    });
    expect(subscriptionLine(full, '2026-11-21')).toBe(
      'Max 20x · started 5 Mar 2024 · renews on the 5th (estimated from the start date) · next 5 Dec · Rs 24,000 a month · paid extra use off, last seen on the Mac'
    );
  });

  it('drops "estimated" once the billing day is entered', () => {
    const line = subscriptionLine(sub({ subscription_started_on: '2024-03-05', billing_day: 7 }), '2026-11-21');
    expect(line).toBe('started 5 Mar 2024 · renews on the 7th · next 7 Dec · monthly fee not entered');
  });

  it('shows only the parts that are known', () => {
    expect(subscriptionLine(sub({ monthly_fee_inr: 24000 }), '2026-11-21')).toBe('Rs 24,000 a month');
    expect(subscriptionLine(sub({ plan_name: 'Max 20x' }), '2026-11-21')).toBe('Max 20x · monthly fee not entered');
    expect(subscriptionLine(sub({ extra_usage_on: true }), '2026-11-21')).toBe('paid extra use on, last seen on the Mac');
    expect(subscriptionLine(sub({ billing_note: 'card ends 4411' }), '2026-11-21')).toBe('note: card ends 4411');
  });

  it('says the fee is missing when the plan or start date is known without it (the Mac feed fills those)', () => {
    const fromFeed = sub({ plan_name: 'Max 20x', subscription_started_on: '2024-03-05', extra_usage_on: false });
    expect(subscriptionLine(fromFeed, '2026-11-21')).toBe(
      'Max 20x · started 5 Mar 2024 · renews on the 5th (estimated from the start date) · next 5 Dec · monthly fee not entered · paid extra use off, last seen on the Mac'
    );
    // Not when only something else is known, and not once the fee is entered (0 counts as entered).
    expect(subscriptionLine(sub({ billing_day: 7 }), '2026-11-21')).not.toContain('fee');
    expect(subscriptionLine(sub({ plan_name: 'Max 20x', monthly_fee_inr: 0 }), '2026-11-21')).toBe('Max 20x · Rs 0 a month');
  });

  it('says where paid extra use was seen: it comes from the Mac and can be behind', () => {
    for (const [value, word] of [[true, 'on'], [false, 'off']] as const) {
      const line = subscriptionLine(sub({ plan_name: 'Max 20x', monthly_fee_inr: 24000, extra_usage_on: value }), '2026-11-21');
      expect(line).toBe(`Max 20x · Rs 24,000 a month · paid extra use ${word}, last seen on the Mac`);
    }
    expect(subscriptionLine(sub({ plan_name: 'Max 20x', monthly_fee_inr: 24000 }), '2026-11-21')).not.toContain('extra use');
  });

  it('says so when nothing is known', () => {
    expect(subscriptionLine(sub(), '2026-11-21')).toBe(NO_SUBSCRIPTION_DETAILS);
    expect(NO_SUBSCRIPTION_DETAILS).toBe('Subscription details not entered yet.');
  });

  it('gets the small words right: 1st, 2nd, 3rd, 11th, 21st, 31st, today, next year', () => {
    const next = (day: number, today = '2026-11-01') => subscriptionLine(sub({ billing_day: day }), today);
    expect(next(1)).toBe('renews on the 1st · renews today');
    expect(next(2)).toContain('renews on the 2nd · next 2 Nov');
    expect(next(3)).toContain('the 3rd');
    expect(next(11)).toContain('the 11th');
    expect(next(12)).toContain('the 12th');
    expect(next(13)).toContain('the 13th');
    expect(next(21)).toContain('the 21st');
    expect(next(22)).toContain('the 22nd');
    expect(next(23)).toContain('the 23rd');
    expect(next(31)).toBe('renews on the 31st · next 30 Nov');
    expect(next(5, '2026-12-21')).toBe('renews on the 5th · next 5 Jan 2027');
  });

  it('writes rupees the Indian way', () => {
    expect([rupees(0), rupees(500), rupees(24000), rupees(120000), rupees(1234567), rupees(24000.5)]).toEqual([
      'Rs 0',
      'Rs 500',
      'Rs 24,000',
      'Rs 1,20,000',
      'Rs 12,34,567',
      'Rs 24,000.50'
    ]);
  });

  it('uses no jargon and no stored names', () => {
    const line = subscriptionLine(sub({ plan_name: 'Max 20x', subscription_started_on: '2024-03-05', monthly_fee_inr: 24000, extra_usage_on: true }), '2026-11-21');
    expect(line).not.toMatch(/billing_day|monthly_fee|overage|token|api|util|probe|null|undefined/i);
  });
});

describe('paidButUnusable: the one flag', () => {
  const paid = sub({ monthly_fee_inr: 24000 });

  it('flags an account that is blocked or whose key is rejected, when a fee is entered', () => {
    expect(paidButUnusable('blocked', paid)).toBe(true);
    expect(paidButUnusable('key-rejected', paid)).toBe(true);
    expect(PAID_BUT_UNUSABLE).toBe('Paid for, but the boxes cannot use it now.');
  });

  it('does not flag it without a fee, or when the check says anything else', () => {
    expect(paidButUnusable('blocked', sub())).toBe(false);
    expect(paidButUnusable('blocked', sub({ monthly_fee_inr: 0 }))).toBe(false);
    expect(paidButUnusable('blocked', undefined)).toBe(false);
    for (const kind of ['working', 'no-allowance', 'too-slow', 'failed', 'not-checked', 'rechecking', 'checking', 'unknown'] as const) {
      expect(paidButUnusable(kind, paid)).toBe(false);
    }
    // No key stored in the Control Tower: there is no check to go by.
    expect(paidButUnusable(undefined, paid)).toBe(false);
  });
});

describe('subscriptionSchema: what the editor may save', () => {
  const good = { plan_name: 'Max 20x', subscription_started_on: '2024-03-05', billing_day: 5, monthly_fee_inr: 24000, billing_note: null };
  const ok = (over: Record<string, unknown>) => subscriptionSchema.safeParse({ ...good, ...over }).success;

  it('accepts a full set, and "not known" for each field', () => {
    expect(subscriptionSchema.parse(good)).toEqual(good);
    expect(ok({ plan_name: null, subscription_started_on: null, billing_day: null, monthly_fee_inr: null })).toBe(true);
  });

  it('turns an empty or blank text into "not known" and trims the rest', () => {
    expect(subscriptionSchema.parse({ ...good, plan_name: '   ', billing_note: '  paid by card  ' })).toMatchObject({
      plan_name: null,
      billing_note: 'paid by card'
    });
  });

  it('refuses a date that does not exist, a billing day outside 1 to 31, and a fee that is not a sensible number', () => {
    for (const bad of [
      { subscription_started_on: '2026-02-30' },
      { subscription_started_on: '05/03/2024' },
      { subscription_started_on: '1999-12-31' },
      { billing_day: 0 },
      { billing_day: 32 },
      { billing_day: 5.5 },
      { billing_day: '5' },
      { monthly_fee_inr: -1 },
      { monthly_fee_inr: 24000.123 },
      { monthly_fee_inr: 1e9 },
      { monthly_fee_inr: '24000' },
      { plan_name: 'x'.repeat(61) },
      { billing_note: 'x'.repeat(301) }
    ]) {
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('takes only the fields that changed: one left out is not in what gets saved', () => {
    expect(subscriptionSchema.parse({ monthly_fee_inr: 24000 })).toEqual({ monthly_fee_inr: 24000 });
    expect(Object.keys(subscriptionSchema.parse({ monthly_fee_inr: 24000 }))).toEqual(['monthly_fee_inr']);
    // A field that was emptied is sent as "not known" and stays in.
    expect(subscriptionSchema.parse({ plan_name: null })).toEqual({ plan_name: null });
    expect(subscriptionSchema.parse({ plan_name: '  ', billing_day: 7 })).toEqual({ plan_name: null, billing_day: 7 });
    for (const key of Object.keys(good)) {
      const one = { [key]: (good as Record<string, unknown>)[key] };
      expect(Object.keys(subscriptionSchema.parse(one)), key).toEqual([key]);
    }
  });

  it('refuses nothing at all, and anything extra: the key and the priority cannot ride along', () => {
    expect(subscriptionSchema.safeParse({}).success).toBe(false);
    expect(subscriptionSchema.safeParse({ plan_name: undefined }).success).toBe(false);
    expect(ok({ key: 'anything' })).toBe(false);
    expect(ok({ ciphertext: 'anything' })).toBe(false);
    expect(ok({ priority: 1 })).toBe(false);
    expect(ok({ extra_usage_on: true })).toBe(false);
  });
});

describe('readSubscriptions (for the card)', () => {
  const admin = (answer: { data: unknown; error: unknown } | 'throws', asked: string[] = []) =>
    ({
      from: (table: string) => ({
        select: async (columns: string) => {
          asked.push(`${table}: ${columns}`);
          if (answer === 'throws') throw new Error('connection lost');
          return answer;
        }
      })
    }) as unknown as SupabaseClient;

  it('gives each account its details, with numbers as numbers', async () => {
    const asked: string[] = [];
    const out = await readSubscriptions(
      admin(
        {
          data: [
            { label: 'aiahs', plan_name: 'Max 20x', subscription_started_on: '2024-03-05', billing_day: 5, monthly_fee_inr: '24000', extra_usage_on: false, billing_note: null },
            { label: 'aiece', plan_name: null, subscription_started_on: null, billing_day: null, monthly_fee_inr: null, extra_usage_on: null, billing_note: null }
          ],
          error: null
        },
        asked
      )
    );
    expect(out?.get('aiahs')).toEqual(
      sub({ plan_name: 'Max 20x', subscription_started_on: '2024-03-05', billing_day: 5, monthly_fee_inr: 24000, extra_usage_on: false })
    );
    // Columns there, nothing typed in yet: the card says so and offers the editor.
    expect(subscriptionLine(out!.get('aiece')!, '2026-11-21')).toBe(NO_SUBSCRIPTION_DETAILS);
    // It never asks for the key or the readings.
    expect(asked).toEqual(['ai_accounts: label, plan_name, subscription_started_on, billing_day, monthly_fee_inr, extra_usage_on, billing_note']);
  });

  it('gives null, not an empty list, while the columns do not exist yet or the read fails', async () => {
    const missing = { code: '42703', message: 'column ai_accounts.plan_name does not exist' };
    expect(await readSubscriptions(admin({ data: null, error: missing }))).toBeNull();
    expect(await readSubscriptions(admin({ data: null, error: { message: 'down' } }))).toBeNull();
    expect(await readSubscriptions(admin('throws'))).toBeNull();
  });
});
