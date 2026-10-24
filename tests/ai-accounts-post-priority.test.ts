import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Re-pasting a key with the Priority box empty must not wipe the account's
 * priority: a body without `priority` upserts ai_accounts without a priority
 * key, and a body with one writes it.
 */

const calls = vi.hoisted(() => ({ upserts: [] as { table: string; payload: Record<string, unknown> }[] }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        calls.upserts.push({ table, payload });
        return { error: null };
      },
    }),
  }),
}));

vi.mock('@/lib/ai-engine/admin', () => ({ isSuperAdmin: vi.fn(async () => true) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({ sealAccountKey: vi.fn(() => 'sealed-ciphertext') }));

const { POST } = await import('@/app/api/internal/ai-engine/accounts/route');

function post(body: Record<string, unknown>) {
  return new NextRequest('https://bugs.example.com/api/internal/ai-engine/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const KEY = 'x'.repeat(40);

function accountsUpsert() {
  const found = calls.upserts.filter((u) => u.table === 'ai_accounts');
  expect(found).toHaveLength(1);
  return found[0].payload;
}

describe('POST /api/internal/ai-engine/accounts priority handling', () => {
  beforeEach(() => {
    calls.upserts.length = 0;
  });

  it('omits priority from the ai_accounts upsert when the body has none (keeps the existing priority)', async () => {
    const res = await POST(post({ label: 'aimech', key: KEY }));
    expect(res?.status).toBe(201);
    const payload = accountsUpsert();
    expect(payload).toEqual({ label: 'aimech' });
    expect('priority' in payload).toBe(false);
  });

  it('writes the priority when the body has one', async () => {
    const res = await POST(post({ label: 'aimech', key: KEY, priority: 3 }));
    expect(res?.status).toBe(201);
    expect(accountsUpsert()).toEqual({ label: 'aimech', priority: 3 });
  });
});
