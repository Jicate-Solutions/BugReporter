import { describe, it, expect } from 'vitest';
import { subscriptionSchema } from '@/lib/ai-engine/account-billing';
import { subscriptionChanges, subscriptionFields } from '@/lib/ai-engine/subscription-edit';

/**
 * What the subscription editor sends on Save (review of #103, 22 Nov 2026):
 * only the fields changed since it was opened. The case it is for: the page
 * was loaded with an empty plan, the Mac's feed then filled the plan and the
 * start date, and the admin types only a fee. The old editor sent its empty
 * plan back and wiped them.
 */

const empty = subscriptionFields({ planName: null, startedOn: null, billingDay: null, monthlyFee: null, note: null });
const full = subscriptionFields({ planName: 'Max 20x', startedOn: '2024-03-05', billingDay: 5, monthlyFee: 24000, note: 'office card' });

describe('subscriptionFields', () => {
  it('shows "not known" as an empty field and numbers as text', () => {
    expect(empty).toEqual({ plan: '', started: '', day: '', fee: '', note: '' });
    expect(full).toEqual({ plan: 'Max 20x', started: '2024-03-05', day: '5', fee: '24000', note: 'office card' });
  });
});

describe('subscriptionChanges', () => {
  it('sends nothing when nothing was changed', () => {
    expect(subscriptionChanges(empty, empty)).toEqual({});
    expect(subscriptionChanges(full, { ...full })).toEqual({});
  });

  it('a fee typed into an editor that opened empty sends the fee alone: no plan, no start date', () => {
    const changes = subscriptionChanges(empty, { ...empty, fee: '24000' });
    expect(changes).toEqual({ monthly_fee_inr: 24000 });
    expect(Object.keys(changes)).toEqual(['monthly_fee_inr']);
    expect('plan_name' in changes).toBe(false);
    expect('subscription_started_on' in changes).toBe(false);
  });

  it('sends each changed field, and only those', () => {
    expect(subscriptionChanges(full, { ...full, plan: 'Max 5x' })).toEqual({ plan_name: 'Max 5x' });
    expect(subscriptionChanges(full, { ...full, started: '2024-04-01' })).toEqual({ subscription_started_on: '2024-04-01' });
    expect(subscriptionChanges(full, { ...full, day: '7' })).toEqual({ billing_day: 7 });
    expect(subscriptionChanges(full, { ...full, fee: '18000.5' })).toEqual({ monthly_fee_inr: 18000.5 });
    expect(subscriptionChanges(full, { ...full, note: 'new card' })).toEqual({ billing_note: 'new card' });
    expect(subscriptionChanges(empty, full)).toEqual({
      plan_name: 'Max 20x',
      subscription_started_on: '2024-03-05',
      billing_day: 5,
      monthly_fee_inr: 24000,
      billing_note: 'office card'
    });
  });

  it('a field the admin emptied is sent as "not known"', () => {
    expect(subscriptionChanges(full, { ...full, plan: '' })).toEqual({ plan_name: null });
    expect(subscriptionChanges(full, { ...full, plan: '   ', started: '' })).toEqual({ plan_name: null, subscription_started_on: null });
    expect(subscriptionChanges(full, empty)).toEqual({
      plan_name: null,
      subscription_started_on: null,
      billing_day: null,
      monthly_fee_inr: null,
      billing_note: null
    });
  });

  it('compares by meaning: spaces, and the same number written another way, are not a change', () => {
    expect(subscriptionChanges(full, { ...full, plan: ' Max 20x ', note: 'office card  ', fee: '24000.0', day: '05' })).toEqual({});
    expect(subscriptionChanges(empty, { ...empty, plan: '   ', note: ' ' })).toEqual({});
    expect(subscriptionChanges(full, { ...full, plan: '  Max 5x ' })).toEqual({ plan_name: 'Max 5x' });
  });

  it('typing something and putting it back sends nothing', () => {
    expect(subscriptionChanges(full, { ...full, fee: '24000' })).toEqual({});
  });

  it('whatever it sends, the accounts route takes, with the same fields', () => {
    for (const now of [{ ...empty, fee: '24000' }, { ...full, plan: '' }, full, { ...full, day: '31', note: '' }]) {
      for (const opened of [empty, full]) {
        const changes = subscriptionChanges(opened, now);
        if (!Object.keys(changes).length) continue;
        const parsed = subscriptionSchema.safeParse(changes);
        expect(parsed.success).toBe(true);
        expect(Object.keys(parsed.data ?? {}).sort()).toEqual(Object.keys(changes).sort());
      }
    }
  });
});
