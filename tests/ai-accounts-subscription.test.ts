import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PATCH /api/internal/ai-engine/accounts with { label, subscription }: a
 * platform admin types in an account's subscription details (21 Nov 2026).
 * Same admin check as the rest of the route; every field is checked; only the
 * five subscription columns are written and the keys table is never touched.
 * Only the fields that are sent are written (22 Nov 2026): one left out keeps
 * what is stored, so what the Mac's feed filled is not wiped by another save.
 * The older { label, priority } body still works as before.
 */

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  isAdmin: true,
  touched: [] as string[],
  updates: [] as { table: string; row: Row; label: unknown }[],
  accounts: ['aiahs', 'aimech'],
  updateError: null as null | { code?: string; message: string }
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } })
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      state.touched.push(table);
      let row: Row = {};
      let label: unknown;
      const b: Record<string, unknown> = {
        update: (r: Row) => ((row = r), b),
        eq: (_c: string, v: unknown) => ((label = v), b),
        select: () => b,
        maybeSingle: async () => {
          if (state.updateError) return { data: null, error: state.updateError };
          if (!state.accounts.includes(String(label))) return { data: null, error: null };
          state.updates.push({ table, row, label });
          return { data: { label, ...row }, error: null };
        }
      };
      return b;
    }
  })
}));
vi.mock('@/lib/ai-engine/admin', () => ({ isSuperAdmin: vi.fn(async () => state.isAdmin) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({ sealAccountKey: vi.fn(() => 'sealed') }));

const { PATCH } = await import('@/app/api/internal/ai-engine/accounts/route');

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('https://tower.example.com/api/internal/ai-engine/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );

const details = (over: Row = {}) => ({
  plan_name: 'Max 20x',
  subscription_started_on: '2024-03-05',
  billing_day: 5,
  monthly_fee_inr: 24000,
  billing_note: 'paid by the office card',
  ...over
});

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.isAdmin = true;
  state.touched = [];
  state.updates = [];
  state.updateError = null;
});

describe('PATCH /api/internal/ai-engine/accounts { label, subscription }', () => {
  it('saves the five subscription details of one account, and nothing else', async () => {
    const res = await patch({ label: 'aiahs', subscription: details() });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ table: 'ai_accounts', label: 'aiahs', row: details() }]);
    expect(Object.keys(state.updates[0].row).sort()).toEqual(
      ['billing_day', 'billing_note', 'monthly_fee_inr', 'plan_name', 'subscription_started_on']
    );
  });

  it('never touches the keys table', async () => {
    await patch({ label: 'aiahs', subscription: details() });
    expect(state.touched).toEqual(['ai_accounts']);
    expect(state.touched).not.toContain('ai_account_secrets');
  });

  it('saves "not known" for a field left empty', async () => {
    const res = await patch({ label: 'aiahs', subscription: details({ plan_name: '  ', billing_day: null, billing_note: '' }) });
    expect(res.status).toBe(200);
    expect(state.updates[0].row).toMatchObject({ plan_name: null, billing_day: null, billing_note: null });
  });

  describe('only what the admin changed is saved (review of #103)', () => {
    // The stored row as the Mac's feed left it after the page was loaded: the admin's page still shows an empty plan.
    const stored = (): Row => ({ plan_name: 'Max 20x', subscription_started_on: '2024-03-05', extra_usage_on: true, billing_day: null, monthly_fee_inr: null, billing_note: null });
    const afterSave = () => ({ ...stored(), ...state.updates[0].row });

    it('a fee-only save writes the fee alone: the plan and start date the feed filled survive', async () => {
      const res = await patch({ label: 'aiahs', subscription: { monthly_fee_inr: 24000 } });
      expect(res.status).toBe(200);
      expect(state.updates).toEqual([{ table: 'ai_accounts', label: 'aiahs', row: { monthly_fee_inr: 24000 } }]);
      expect(Object.keys(state.updates[0].row)).toEqual(['monthly_fee_inr']);
      expect(afterSave()).toMatchObject({ plan_name: 'Max 20x', subscription_started_on: '2024-03-05', extra_usage_on: true, monthly_fee_inr: 24000 });
      expect((await res.json()).account).toEqual({ label: 'aiahs', subscription: { monthly_fee_inr: 24000 } });
    });

    it('each field can be saved by itself, and nothing else is written with it', async () => {
      for (const [key, value] of Object.entries(details())) {
        state.updates = [];
        expect((await patch({ label: 'aiahs', subscription: { [key]: value } })).status, key).toBe(200);
        expect(state.updates[0].row, key).toEqual({ [key]: value });
      }
    });

    it('a field the admin emptied is still set to "not known", and only that field', async () => {
      expect((await patch({ label: 'aiahs', subscription: { plan_name: null } })).status).toBe(200);
      expect(state.updates[0].row).toEqual({ plan_name: null });
      expect(afterSave()).toMatchObject({ plan_name: null, subscription_started_on: '2024-03-05' });
      state.updates = [];
      expect((await patch({ label: 'aiahs', subscription: { subscription_started_on: null, billing_note: '' } })).status).toBe(200);
      expect(state.updates[0].row).toEqual({ subscription_started_on: null, billing_note: null });
    });

    it('a future start date is still refused when it comes alone, and paid extra use can never be typed', async () => {
      expect((await patch({ label: 'aiahs', subscription: { subscription_started_on: '2999-01-01' } })).status).toBe(400);
      expect((await patch({ label: 'aiahs', subscription: { extra_usage_on: false } })).status).toBe(400);
      expect((await patch({ label: 'aiahs', subscription: { monthly_fee_inr: 24000, extra_usage_on: false } })).status).toBe(400);
      expect(state.updates).toEqual([]);
    });
  });

  it('is for platform admins only, like the rest of the route', async () => {
    state.isAdmin = false;
    const forbidden = await patch({ label: 'aiahs', subscription: details() });
    expect(forbidden.status).toBe(403);
    state.user = null;
    expect((await patch({ label: 'aiahs', subscription: details() })).status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it('refuses bad details with one plain sentence and saves nothing', async () => {
    for (const bad of [
      details({ subscription_started_on: '2026-02-30' }),
      details({ billing_day: 32 }),
      details({ billing_day: 0 }),
      details({ monthly_fee_inr: -5 }),
      details({ monthly_fee_inr: 'a lot' }),
      details({ key: 'sk-ant-oat01-anything' }),
      details({ priority: 1 }),
      { plan_name: 'Max 20x', billing_day: 32 },
      {}
    ]) {
      const res = await patch({ label: 'aiahs', subscription: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      const message = (await res.json()).error.message as string;
      expect(message).toContain('billing day from 1 to 31');
      expect(message).not.toMatch(/zod|invalid_type|subscription_started_on|monthly_fee_inr/);
    }
    expect(state.updates).toEqual([]);
  });

  it('refuses a start date in the future', async () => {
    const res = await patch({ label: 'aiahs', subscription: details({ subscription_started_on: '2999-01-01' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('The start date cannot be in the future.');
    expect(state.updates).toEqual([]);
  });

  it('refuses the box\'s own sign-in, "auto", a bad label, and anything beside label and subscription', async () => {
    for (const label of ['default', 'auto', 'Bad Label', '']) {
      expect((await patch({ label, subscription: details() })).status).toBe(400);
    }
    expect((await patch({ label: 'aiahs', subscription: details(), priority: 1 })).status).toBe(400);
    expect((await patch({ label: 'aiahs', subscription: null })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('says 404 for an account that does not exist, and creates nothing', async () => {
    const res = await patch({ label: 'nobody', subscription: details() });
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it('says in plain words when the database is not ready for it yet', async () => {
    state.updateError = { code: 'PGRST204', message: "Could not find the 'plan_name' column of 'ai_accounts' in the schema cache" };
    const res = await patch({ label: 'aiahs', subscription: details() });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_READY');
    expect(body.error.message).toBe(
      'Subscription details cannot be saved yet: the Control Tower needs a small database update first.'
    );
    expect(JSON.stringify(body)).not.toContain('schema cache');

    state.updateError = { message: 'down' };
    const other = await patch({ label: 'aiahs', subscription: details() });
    expect(other.status).toBe(500);
    expect((await other.json()).error.message).toBe('Could not save the change.');
  });
});

describe('PATCH /api/internal/ai-engine/accounts { label, priority } still works', () => {
  it('sets the priority and nothing else', async () => {
    const res = await patch({ label: 'aimech', priority: 2 });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ table: 'ai_accounts', label: 'aimech', row: { priority: 2 } }]);
  });

  it('still refuses a bad priority with its own sentence', async () => {
    const res = await patch({ label: 'aimech', priority: 100 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Priority must be a whole number from 1 to 99.');
  });
});
