import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Re-pasting a key with the Priority box empty must not wipe the account's
 * priority: a body without `priority` upserts ai_accounts without a priority
 * key, and a body with one writes it.
 *
 * And (20 Nov 2026): a value that is not a setup-token key is refused with
 * nothing stored, and a saved key is checked at once (one check job queued).
 */

const calls = vi.hoisted(() => ({
  upserts: [] as { table: string; payload: Record<string, unknown> }[],
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  rpcAnswer: { ok: true, job_id: 'job-1' } as Record<string, unknown>,
  sealed: [] as string[]
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args });
      return { data: calls.rpcAnswer, error: null };
    },
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        calls.upserts.push({ table, payload });
        return { error: null };
      },
    }),
  }),
}));

vi.mock('@/lib/ai-engine/admin', () => ({ isSuperAdmin: vi.fn(async () => true) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({
  sealAccountKey: vi.fn((key: string) => {
    calls.sealed.push(key);
    return 'sealed-ciphertext';
  })
}));

const { POST } = await import('@/app/api/internal/ai-engine/accounts/route');
const { ACCOUNT_KEY_PREFIX } = await import('@/lib/ai-engine/account-key-shape');

function post(body: Record<string, unknown>) {
  return new NextRequest('https://bugs.example.com/api/internal/ai-engine/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Shaped like a setup-token key (prefix plus filler); never a real-looking literal.
const KEY = ACCOUNT_KEY_PREFIX + 'A'.repeat(95);

function accountsUpsert() {
  const found = calls.upserts.filter((u) => u.table === 'ai_accounts');
  expect(found).toHaveLength(1);
  return found[0].payload;
}

describe('POST /api/internal/ai-engine/accounts priority handling', () => {
  beforeEach(() => {
    calls.upserts.length = 0;
    calls.rpc.length = 0;
    calls.sealed.length = 0;
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

describe('POST /api/internal/ai-engine/accounts key check', () => {
  beforeEach(() => {
    calls.upserts.length = 0;
    calls.rpc.length = 0;
    calls.sealed.length = 0;
  });

  it('refuses a 92-character value that is not a key, stores nothing, queues nothing', async () => {
    const notAKey = 'Z9'.repeat(46);
    const res = await POST(post({ label: 'aieee', key: notAKey }));
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.error.code).toBe('BAD_KEY');
    expect(body.error.message).toContain(ACCOUNT_KEY_PREFIX);
    // the pasted value is never sent back
    expect(JSON.stringify(body)).not.toContain(notAKey.slice(0, 12));
    expect(calls.upserts).toHaveLength(0);
    expect(calls.sealed).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it('refuses a key cut short, stores nothing', async () => {
    const res = await POST(post({ label: 'aieee', key: ACCOUNT_KEY_PREFIX + 'A'.repeat(40) }));
    expect(res?.status).toBe(400);
    expect((await res!.json()).error.message).toContain('Part of the key is missing');
    expect(calls.upserts).toHaveLength(0);
  });

  it('stores a key pasted wrapped onto two lines without its spaces and line breaks', async () => {
    const res = await POST(post({ label: 'aieee', key: ` ${KEY.slice(0, 60)}\n  ${KEY.slice(60)}\n` }));
    expect(res?.status).toBe(201);
    expect(calls.sealed).toEqual([KEY]);
  });

  it('queues one check of the saved account at once and says so', async () => {
    const res = await POST(post({ label: 'aieee', key: KEY }));
    expect(res?.status).toBe(201);
    expect((await res!.json()).check_queued).toBe(true);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe('fn_ai_engine_enqueue');
    expect(calls.rpc[0].args).toMatchObject({
      p_job_type: 'system.account_probe',
      p_app_slug: 'control-tower',
      p_payload: { label: 'aieee' },
      p_dedupe_key: 'probe:aieee'
    });
    // the key is never part of the check job
    expect(JSON.stringify(calls.rpc)).not.toContain(KEY);
  });

  it('saves the key and says the check was NOT queued when the queue refuses it or merges it into an older check', async () => {
    try {
      for (const answer of [{ ok: false, error: 'task_switched_off' }, { ok: true, job_id: 'older', deduped: true }]) {
        calls.rpcAnswer = answer;
        const res = await POST(post({ label: 'aieee', key: KEY }));
        expect(res?.status).toBe(201);
        expect((await res!.json()).check_queued).toBe(false);
      }
      expect(calls.upserts.filter((u) => u.table === 'ai_account_secrets')).toHaveLength(2);
    } finally {
      calls.rpcAnswer = { ok: true, job_id: 'job-1' };
    }
  });
});
