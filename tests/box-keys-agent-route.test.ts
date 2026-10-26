import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

/**
 * Box keys through the box-agent route: the poll lists this box's pending,
 * allow-listed keys with NO value; ?box_key=<id> hands the value to that box
 * only and logs it; box_key_update marks delivered / failed only for the value
 * the box fetched (set_at must match), and only this box's row.
 */

const VALUE = 'ghp_' + 'Z9y8X7w6V5'.repeat(4);
const TOKENS: Record<string, string> = { 'DESKTOP-1LB1FCS': 'd'.repeat(40), Biometric: 'b'.repeat(40) };
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, inserts: [] as { table: string; row: Row }[] }));

vi.mock('@/lib/ai-engine/accounts', () => ({ resolveBoxAccount: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({
  openAccountKey: vi.fn((s: string) => (s === 'sealed-good' ? 'ghp_' + 'Z9y8X7w6V5'.repeat(4) : (() => { throw new Error('bad'); })())),
  sealAccountKey: vi.fn(() => 'sealed-good')
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (!db.tables[table]) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        const hit = rows();
        if (patch) {
          for (const r of hit) Object.assign(r, patch);
          return { data: hit.map((r) => ({ target_id: r.target_id })), error: null };
        }
        return { data: hit, count: hit.length, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        lte: () => b,
        lt: () => b,
        gt: () => b,
        order: () => b,
        limit: () => b,
        update: (row: Row) => ((patch = row), b),
        upsert: async () => ({ error: null }),
        insert: async (row: Row) => (db.inserts.push({ table, row }), { error: null }),
        maybeSingle: async () => {
          const r = run();
          return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej)
      };
      return b;
    }
  })
}));

const { GET, POST } = await import('@/app/api/internal/ai-engine/box-agent/route');

const URL_BASE = 'https://tower.test/api/internal/ai-engine/box-agent';
const auth = (box: string) => ({ Authorization: `Bearer ${TOKENS[box]}` });
const get = (box: string, q = '?have=default') => new NextRequest(`${URL_BASE}${q}`, { headers: auth(box) });
const post = (box: string, body: unknown) =>
  new NextRequest(URL_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(box) }, body: JSON.stringify(body) });

const SET_AT = '2026-10-26T15:00:00.000+00:00';
const keyRow = () => db.tables.ai_box_keys[0];

beforeEach(() => {
  db.inserts.length = 0;
  db.tables = {
    ai_box_agent_tokens: Object.entries(TOKENS).map(([host, t]) => ({ host, token_sha256: sha(t), revoked_at: null })),
    ai_boxes: [],
    ai_runners: [],
    ai_jobs: [],
    ai_box_files: [],
    ai_box_commands: [],
    ai_box_keys: [
      {
        host: 'DESKTOP-1LB1FCS',
        target_id: 'build-worker-github-token',
        ciphertext: 'sealed-good',
        set_at: SET_AT,
        fetched_at: null,
        delivered_at: null,
        delivery_error: null
      },
      // A stray row for a target that is not on the allow-list: never handed out.
      { host: 'DESKTOP-1LB1FCS', target_id: 'evil', ciphertext: 'sealed-good', set_at: SET_AT, delivered_at: null, delivery_error: null }
    ]
  };
});

describe('poll lists pending box keys without the value', () => {
  it('gives the owning box its allow-listed key: file and variable from code, no value', async () => {
    const res = await GET(get('DESKTOP-1LB1FCS'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(VALUE);
    expect(JSON.parse(text).box_keys).toEqual([
      {
        id: 'build-worker-github-token',
        file: 'C:\\jicate-ai\\build-worker\\build-worker.env',
        name: 'BUILD_GITHUB_TOKEN',
        set_at: SET_AT
      }
    ]);
  });

  it('gives another box nothing, and nothing once delivered or failed', async () => {
    expect((await (await GET(get('Biometric'))).json()).box_keys).toEqual([]);
    keyRow().delivered_at = '2026-10-26T15:01:00Z';
    expect((await (await GET(get('DESKTOP-1LB1FCS'))).json()).box_keys).toEqual([]);
    keyRow().delivered_at = null;
    keyRow().delivery_error = 'file missing';
    expect((await (await GET(get('DESKTOP-1LB1FCS'))).json()).box_keys).toEqual([]);
  });

  it('still answers the poll when the table is not there yet', async () => {
    delete db.tables.ai_box_keys;
    const res = await GET(get('DESKTOP-1LB1FCS'));
    expect(res.status).toBe(200);
    expect((await res.json()).box_keys).toEqual([]);
  });
});

describe('?box_key=<id>', () => {
  it('hands the value to the owning box, logs it and stamps fetched_at', async () => {
    const res = await GET(get('DESKTOP-1LB1FCS', '?box_key=build-worker-github-token'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      id: 'build-worker-github-token',
      file: 'C:\\jicate-ai\\build-worker\\build-worker.env',
      name: 'BUILD_GITHUB_TOKEN',
      set_at: SET_AT,
      value: VALUE
    });
    const logs = db.inserts.filter((i) => i.table === 'ai_account_key_fetches');
    expect(logs).toHaveLength(1);
    expect(logs[0].row).toMatchObject({ runner: 'box-agent@DESKTOP-1LB1FCS', label: 'build-worker-github-token', granted: true });
    expect(JSON.stringify(logs[0].row)).not.toContain(VALUE);
    expect(keyRow().fetched_at).toBeTruthy();
  });

  it('refuses another box, a target off the allow-list, and a delivered key', async () => {
    expect((await GET(get('Biometric', '?box_key=build-worker-github-token'))).status).toBe(404);
    expect((await GET(get('DESKTOP-1LB1FCS', '?box_key=evil'))).status).toBe(404);
    keyRow().delivered_at = '2026-10-26T15:01:00Z';
    expect((await GET(get('DESKTOP-1LB1FCS', '?box_key=build-worker-github-token'))).status).toBe(404);
  });

  it('refuses without a valid agent token', async () => {
    const res = await GET(new NextRequest(`${URL_BASE}?box_key=build-worker-github-token`, { headers: { Authorization: `Bearer ${'x'.repeat(40)}` } }));
    expect(res.status).toBe(401);
  });
});

describe('box_key_update', () => {
  it('marks the fetched value delivered', async () => {
    const res = await POST(post('DESKTOP-1LB1FCS', { box_key_update: { id: 'build-worker-github-token', set_at: SET_AT, status: 'delivered' } }));
    expect(await res.json()).toEqual({ ok: true, box_key: { id: 'build-worker-github-token', moved: true } });
    expect(keyRow().delivered_at).toBeTruthy();
    expect(keyRow().delivery_error).toBeNull();
  });

  it('records a failure reason', async () => {
    await POST(post('DESKTOP-1LB1FCS', { box_key_update: { id: 'build-worker-github-token', set_at: SET_AT, status: 'failed', reason: 'file missing' } }));
    expect(keyRow().delivery_error).toBe('file missing');
    expect(keyRow().delivered_at).toBeNull();
  });

  it('does not move a key replaced since it was fetched, nor another box\'s key', async () => {
    const stale = await POST(post('DESKTOP-1LB1FCS', { box_key_update: { id: 'build-worker-github-token', set_at: '2026-10-26T14:00:00.000+00:00', status: 'delivered' } }));
    expect((await stale.json()).box_key.moved).toBe(false);
    const other = await POST(post('Biometric', { box_key_update: { id: 'build-worker-github-token', set_at: SET_AT, status: 'delivered' } }));
    expect((await other.json()).box_key.moved).toBe(false);
    expect(keyRow().delivered_at).toBeNull();
  });

  it('refuses a reason that could carry a value (only plain words)', async () => {
    const res = await POST(post('DESKTOP-1LB1FCS', { box_key_update: { id: 'build-worker-github-token', set_at: SET_AT, status: 'failed', reason: 'x=$y\n' } }));
    expect(res.status).toBe(400);
  });
});
