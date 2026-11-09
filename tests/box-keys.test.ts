import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';

/**
 * Box keys, Tower side: the value is sealed with the account-key scheme and
 * opens again; only allow-listed targets are accepted; only platform admins
 * can save one; the value never comes back in a response.
 */

process.env.AI_ACCOUNT_KEY_SECRET = randomBytes(32).toString('base64');

const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  superAdmin: true,
  upserts: [] as { table: string; row: Record<string, unknown>; opts: unknown }[]
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } })
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        state.upserts.push({ table, row, opts });
        return { error: null };
      }
    })
  })
}));
vi.mock('@/lib/ai-engine/admin', () => ({ isSuperAdmin: vi.fn(async () => state.superAdmin) }));

const keys = await import('@/lib/ai-engine/box-keys');
const { POST } = await import('@/app/api/internal/ai-engine/box-keys/route');

const VALUE = 'ghp_' + 'A1b2C3d4E5'.repeat(4);
const TARGET = 'build-worker-github-token';
const post = (body: unknown) =>
  new NextRequest('https://tower.test/api/internal/ai-engine/box-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.superAdmin = true;
  state.upserts.length = 0;
});

describe('sealing', () => {
  it('round-trips through the account-key scheme and is not the plain value', () => {
    const sealed = keys.sealBoxKey(VALUE);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(VALUE);
    expect(keys.openBoxKey(sealed)).toBe(VALUE);
  });

  it('refuses a tampered ciphertext', () => {
    const parts = keys.sealBoxKey(VALUE).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 1;
    parts[3] = ct.toString('base64url');
    expect(() => keys.openBoxKey(parts.join('.'))).toThrow();
  });
});

describe('allow-list', () => {
  it('starts with exactly the Box 2 build worker token', () => {
    expect(keys.BOX_KEY_TARGETS).toEqual([
      expect.objectContaining({
        id: TARGET,
        host: 'DESKTOP-1LB1FCS',
        file: 'C:\\jicate-ai\\build-worker\\build-worker.env',
        name: 'BUILD_GITHUB_TOKEN'
      })
    ]);
  });

  it('finds a target by id only, on its own host only (any letter case)', () => {
    expect(keys.findBoxKeyTarget(TARGET)?.name).toBe('BUILD_GITHUB_TOKEN');
    expect(keys.findBoxKeyTarget('C:\\Windows\\win.ini')).toBeNull();
    expect(keys.findBoxKeyTarget({ id: TARGET })).toBeNull();
    expect(keys.resolveBoxKeyTarget('desktop-1lb1fcs', TARGET)?.id).toBe(TARGET);
    expect(keys.resolveBoxKeyTarget('Biometric', TARGET)).toBeNull();
    expect(keys.resolveBoxKeyTarget('DESKTOP-1LB1FCS', 'other')).toBeNull();
  });

  it('accepts token-like values and refuses ones that would break an env line', () => {
    expect(keys.boxKeyValueOk(VALUE)).toBe(true);
    expect(keys.boxKeyValueOk('github_pat_11ABC_def-ghi')).toBe(true);
    for (const bad of ['short', 'has space123', 'line\nbreak1', 'cr\rhere123', 'quote"abcdefg', "it's-abcdefg",
      'hash#abcdefgh', 'dollar$abcdef', 'back\\slash12', 'tick`abcdefgh', 'x'.repeat(1001), 'caf\u00e9-abcdefg']) {
      expect(keys.boxKeyValueOk(bad)).toBe(false);
    }
  });
});

describe('POST /api/internal/ai-engine/box-keys', () => {
  it('denies a signed-in user who is not a platform admin, and saves nothing', async () => {
    state.superAdmin = false;
    const res = await POST(post({ target: TARGET, value: VALUE }));
    expect(res.status).toBe(403);
    expect(state.upserts).toHaveLength(0);
  });

  it('denies a signed-out request', async () => {
    state.user = null;
    const res = await POST(post({ target: TARGET, value: VALUE }));
    expect(res.status).toBe(401);
    expect(state.upserts).toHaveLength(0);
  });

  it('refuses a target that is not on the allow-list, or a raw path / variable', async () => {
    for (const body of [
      { target: 'other', value: VALUE },
      { target: TARGET, value: VALUE, file: 'C:\\Windows\\win.ini', name: 'PATH' },
      { target: 'C:\\jicate-ai\\build-worker\\build-worker.env', value: VALUE }
    ]) {
      const res = await POST(post(body));
      if (body.target === TARGET) {
        // Extra keys are ignored: host, file and variable come from code.
        expect(res.status).toBe(201);
      } else {
        expect(res.status).toBe(400);
      }
    }
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].row).toMatchObject({ host: 'DESKTOP-1LB1FCS', target_id: TARGET });
    expect(state.upserts[0].row).not.toHaveProperty('file');
  });

  it('refuses a value with a line break', async () => {
    const res = await POST(post({ target: TARGET, value: `${VALUE}\nEVIL=1` }));
    expect(res.status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });

  it('stores only the sealed value, resets delivery, and never echoes the value', async () => {
    const res = await POST(post({ target: TARGET, value: `  ${VALUE}  ` }));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(VALUE);
    expect(state.upserts).toHaveLength(1);
    const { table, row, opts } = state.upserts[0];
    expect(table).toBe('ai_box_keys');
    expect(opts).toEqual({ onConflict: 'host,target_id' });
    expect(JSON.stringify(row)).not.toContain(VALUE);
    expect(keys.openBoxKey(row.ciphertext as string)).toBe(VALUE);
    expect(row).toMatchObject({ set_by: 'user-1', fetched_at: null, delivered_at: null, delivery_error: null });
  });
});
