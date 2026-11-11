import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

/**
 * /api/internal/ai-engine/lane-key: a MyJKKN max lane (runner "maxlane-*")
 * gets the key of the account the Tower picks; a JICATE worker token is
 * refused; refused=<label> rolls to the next account and is remembered for
 * every lane; every request is logged; rate limits fail closed. The job routes
 * (claim, complete, account-key) refuse a lane token.
 */

const LANE = 'L'.repeat(64);
const WORKER = 'W'.repeat(64);
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserts: [] as { table: string; row: Row }[],
  rpc: [] as Row[],
  rpcResult: null as null | { data: unknown; error: unknown },
  failTable: null as string | null,
  failInsert: false
}));

vi.mock('@/lib/ai-engine/account-keys', () => ({
  openAccountKey: vi.fn((s: string) => {
    if (s.startsWith('sealed:')) return `key-of-${s.slice(7)}`;
    throw new Error('bad');
  })
}));
vi.mock('@/lib/ai-engine/engine', () => ({ claimEngineJob: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (_fn: string, args: Row) => {
      db.rpc.push(args);
      return db.rpcResult ?? { data: [{ allowed: true, retry_after: 30 }], error: null };
    },
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      const run = () => {
        if (db.failTable === table) return { data: null, error: { message: 'down' } };
        return { data: (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        like: (c: string, p: string) => (filters.push((r) => String(r[c]).startsWith(p.replace(/%$/, ''))), b),
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        order: () => b,
        limit: () => b,
        update: () => b,
        upsert: async () => ({ error: null }),
        insert: async (row: Row) => {
          if (db.failInsert) return { error: { message: 'insert failed' } };
          db.inserts.push({ table, row });
          (db.tables[table] ??= []).push({ ...row, fetched_at: new Date().toISOString() });
          return { error: null };
        },
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

const { GET } = await import('@/app/api/internal/ai-engine/lane-key/route');
const { POST: CLAIM } = await import('@/app/api/internal/ai-engine/claim/route');
const { GET: ACCOUNT_KEY } = await import('@/app/api/internal/ai-engine/account-key/route');
const { chooseLaneAccount, LANE_REFUSAL_MS } = await import('@/lib/ai-engine/accounts');

const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
const freshAt = new Date().toISOString();

function seed() {
  db.tables = {
    ai_runner_tokens: [
      { runner: 'maxlane-biometric', token_sha256: sha(LANE), revoked_at: null },
      { runner: 'jicate-1', token_sha256: sha(WORKER), revoked_at: null }
    ],
    ai_account_secrets: ['aimech', 'ainursing', 'aiahs'].map((l) => ({ label: l, ciphertext: `sealed:${l}` })),
    ai_accounts: [
      { label: 'aimech', priority: 1, five_hour_util: 0.4, seven_day_util: 0.5, five_hour_resets_at: soon, seven_day_resets_at: soon, updated_at: freshAt },
      { label: 'ainursing', priority: 2, five_hour_util: 0.1, seven_day_util: 0.2, five_hour_resets_at: soon, seven_day_resets_at: soon, updated_at: freshAt },
      { label: 'aiahs', priority: 3, five_hour_util: 0.1, seven_day_util: 0.1, five_hour_resets_at: soon, seven_day_resets_at: soon, updated_at: freshAt },
      { label: 'default', priority: 0, five_hour_util: 0, seven_day_util: 0, five_hour_resets_at: soon, seven_day_resets_at: soon, updated_at: freshAt }
    ],
    ai_account_key_fetches: [],
    ai_jobs: [],
    ai_runners: []
  };
  db.inserts.length = 0;
  db.rpc.length = 0;
  db.rpcResult = null;
  db.failTable = null;
  db.failInsert = false;
}

function get(query = '', token = LANE) {
  return GET(
    new NextRequest(`https://tower.example.com/api/internal/ai-engine/lane-key${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  );
}
const logs = () => db.inserts.filter((i) => i.table === 'ai_account_key_fetches').map((i) => i.row);
/** Grant rows, as if the Tower had handed these labels to a lane agoMs ago. */
function handed(labels: string[], runner = 'maxlane-biometric', agoMs = 60_000) {
  const at = new Date(Date.now() - agoMs).toISOString();
  for (const label of labels) {
    db.tables.ai_account_key_fetches.push({ runner, label, job_id: null, host: null, granted: true, reason: 'lane: ok', fetched_at: at });
  }
}

describe('GET /api/internal/ai-engine/lane-key', () => {
  beforeEach(seed);

  it('hands a lane the key of the top-priority account and logs it', async () => {
    const res = await get('?host=BIOMETRIC');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ label: 'aimech', key: 'key-of-aimech' });
    expect(logs()).toEqual([
      { runner: 'maxlane-biometric', label: 'aimech', job_id: null, host: 'BIOMETRIC', granted: true, reason: 'lane: ok' }
    ]);
    // the key itself never reaches the log
    expect(JSON.stringify(db.inserts)).not.toContain('key-of-');
  });

  it('never picks "default" (no key to hand out) even at priority 0', async () => {
    const body = await (await get()).json();
    expect(body.label).not.toBe('default');
  });

  it('refuses a JICATE worker token', async () => {
    const res = await get('', WORKER);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('NOT_A_LANE_TOKEN');
    expect(logs()).toHaveLength(0);
  });

  it('refuses unknown and missing tokens', async () => {
    expect((await get('', 'x'.repeat(64))).status).toBe(401);
    expect((await GET(new NextRequest('https://tower.example.com/api/internal/ai-engine/lane-key'))).status).toBe(401);
  });

  it('rolls to the next account on refused=, logs the refusal, and remembers it for the next ask', async () => {
    handed(['aimech']);
    const res = await get('?refused=aimech');
    expect(await res.json()).toEqual({ label: 'ainursing', key: 'key-of-ainursing' });
    expect(logs().map((r) => [r.label, r.granted, r.reason])).toEqual([
      ['aimech', false, 'lane: refused by claude'],
      ['ainursing', true, 'lane: ok after refusal']
    ]);
    // a later ask with no hint skips aimech for 30 minutes
    expect((await (await get()).json()).label).toBe('ainursing');
  });

  it('uses an account above 95% before giving up', async () => {
    handed(['aimech', 'ainursing']);
    const res = await get('?refused=aimech,ainursing');
    expect((await res.json()).label).toBe('aiahs');
    db.tables.ai_accounts.find((a) => a.label === 'aiahs')!.seven_day_util = 0.99;
    seedRefusals([]);
    handed(['aimech', 'ainursing']);
    const again = await get('?refused=aimech,ainursing');
    expect((await again.json()).label).toBe('aiahs');
  });

  it('answers 409 with a retry time when every account was refused', async () => {
    handed(['aimech', 'ainursing', 'aiahs']);
    const res = await get('?refused=aimech,ainursing,aiahs');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('NO_ACCOUNT_LEFT');
    expect(body.error.retry_after_seconds).toBeGreaterThanOrEqual(60);
    expect(logs().at(-1)).toMatchObject({ granted: false, reason: 'lane: no account left' });
  });

  it('rejects a bad refused list', async () => {
    expect((await get('?refused=AIMECH;drop')).status).toBe(400);
  });

  it('applies the roll cap only to requests carrying refused=', async () => {
    await get(); // hands aimech to this lane
    expect(db.rpc).toHaveLength(1);
    await get('?refused=aimech');
    expect(db.rpc).toHaveLength(3);
    expect(db.rpc[2]).toMatchObject({ p_limit: 60, p_window_seconds: 600 });
  });

  it('answers 429 with Retry-After when the counter trips, and logs it', async () => {
    db.rpcResult = { data: [{ allowed: false, retry_after: 17 }], error: null };
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
    expect(logs()).toEqual([expect.objectContaining({ granted: false, reason: 'lane: rate limited' })]);
  });

  it('fails CLOSED when the rate counter cannot be read', async () => {
    db.rpcResult = { data: null, error: { message: 'function does not exist' } };
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('key-of-');
  });

  it('fails closed when the accounts cannot be read', async () => {
    db.failTable = 'ai_account_key_fetches';
    const res = await get();
    expect(res.status).toBe(503);
  });

  it('releases no key when its log row cannot be written', async () => {
    db.failInsert = true;
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('LOG_UNAVAILABLE');
  });

  it('does not roll on when a refusal cannot be written', async () => {
    handed(['aimech']);
    db.failInsert = true;
    const res = await get('?refused=aimech');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('key-of-');
  });

  it('refuses (400) a refused= label never handed to this lane, benches nothing', async () => {
    const res = await get('?refused=aimech');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(JSON.parse(body).error.code).toBe('REFUSED_NOT_HANDED');
    expect(body).not.toContain('key-of-');
    expect(logs()).toEqual([
      expect.objectContaining({ label: '-', granted: false, reason: 'lane: refused label not handed to this lane' })
    ]);
    // aimech was NOT benched: the next plain ask still gets the top account
    expect((await (await get()).json()).label).toBe('aimech');
  });

  it('refuses (400) a label handed to a DIFFERENT lane', async () => {
    handed(['aimech'], 'maxlane-otherbox');
    expect((await get('?refused=aimech')).status).toBe(400);
  });

  it('refuses (400) a label handed more than 30 minutes ago', async () => {
    handed(['aimech'], 'maxlane-biometric', LANE_REFUSAL_MS + 60_000);
    expect((await get('?refused=aimech')).status).toBe(400);
  });

  it('refuses (400) the whole list when only some labels were handed', async () => {
    handed(['aimech']);
    const res = await get('?refused=aimech,ainursing');
    expect(res.status).toBe(400);
    expect(logs().some((r) => r.reason === 'lane: refused by claude')).toBe(false);
  });

  it('a refusal row (granted=false) does not count as handed', async () => {
    db.tables.ai_account_key_fetches.push({
      runner: 'maxlane-biometric', label: 'aimech', granted: false, reason: 'lane: refused by claude', fetched_at: new Date().toISOString()
    });
    expect((await get('?refused=aimech')).status).toBe(400);
  });

  it('handed then refused: rolls, and the next account can be refused in turn', async () => {
    const first = await (await get()).json();
    expect(first.label).toBe('aimech');
    const second = await (await get('?refused=aimech')).json();
    expect(second.label).toBe('ainursing');
    const third = await (await get('?refused=aimech,ainursing')).json();
    expect(third.label).toBe('aiahs');
  });

  it('fails closed (503) when the key log cannot be read for the ownership / cap check', async () => {
    db.failTable = 'ai_account_key_fetches';
    const res = await get('?refused=aimech');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('LOG_UNAVAILABLE');
  });

  it('logs "-" (not an unchecked label) when a refused= ask is rate limited', async () => {
    db.rpcResult = { data: [{ allowed: false, retry_after: 5 }], error: null };
    expect((await get('?refused=aimech')).status).toBe(429);
    expect(logs()).toEqual([expect.objectContaining({ label: '-', reason: 'lane: rate limited' })]);
  });

  describe('per-token cap: 3 distinct accounts per rolling hour', () => {
    beforeEach(() => {
      db.tables.ai_account_secrets.push({ label: 'aiextra', ciphertext: 'sealed:aiextra' });
      db.tables.ai_accounts.push({ label: 'aiextra', priority: 4, five_hour_util: 0.1, seven_day_util: 0.1, five_hour_resets_at: soon, seven_day_resets_at: soon, updated_at: freshAt });
    });

    it('a 4th distinct account gets 429 ACCOUNT_CAP_REACHED, no key, Retry-After', async () => {
      handed(['ainursing', 'aiahs', 'aiextra'], 'maxlane-biometric', 40 * 60_000);
      const res = await get(); // would pick aimech: a 4th distinct account
      expect(res.status).toBe(429);
      const body = await res.text();
      expect(JSON.parse(body).error.code).toBe('ACCOUNT_CAP_REACHED');
      expect(body).not.toContain('key-of-');
      const wait = Number(res.headers.get('retry-after'));
      expect(wait).toBeGreaterThan(19 * 60 - 5);
      expect(wait).toBeLessThanOrEqual(20 * 60 + 1);
      expect(logs()).toEqual([expect.objectContaining({ label: '-', granted: false, reason: 'lane: account cap reached' })]);
    });

    it('the cap benches nothing: refusals in a capped request are not written', async () => {
      handed(['aimech', 'ainursing', 'aiahs']);
      const res = await get('?refused=aimech,ainursing,aiahs'); // next pick would be aiextra
      expect(res.status).toBe(429);
      expect(logs().some((r) => r.reason === 'lane: refused by claude')).toBe(false);
      // aimech was not benched: a plain ask is handed aimech again (already handed this hour)
      expect((await (await get()).json()).label).toBe('aimech');
    });

    it('re-handing an account already handed this hour is allowed at the cap', async () => {
      handed(['aimech', 'ainursing', 'aiahs']);
      const res = await get();
      expect(res.status).toBe(200);
      expect((await res.json()).label).toBe('aimech');
    });

    it('walking the list stops at the 4th account', async () => {
      expect((await (await get()).json()).label).toBe('aimech');
      expect((await (await get('?refused=aimech')).json()).label).toBe('ainursing');
      expect((await (await get('?refused=aimech,ainursing')).json()).label).toBe('aiahs');
      expect((await get('?refused=aimech,ainursing,aiahs')).status).toBe(429);
    });

    it('grants older than an hour, or to another lane, do not count', async () => {
      handed(['ainursing', 'aiahs', 'aiextra'], 'maxlane-biometric', 61 * 60_000);
      handed(['ainursing', 'aiahs', 'aiextra'], 'maxlane-otherbox');
      expect((await get()).status).toBe(200);
    });
  });

  it('answers 503 and logs when the chosen key cannot be opened', async () => {
    db.tables.ai_account_secrets[0].ciphertext = 'broken';
    const res = await get();
    expect(res.status).toBe(503);
    expect(logs().at(-1)).toMatchObject({ label: 'aimech', granted: false, reason: 'lane: key could not be opened' });
  });
});

function seedRefusals(rows: Row[]) {
  db.tables.ai_account_key_fetches = rows;
}

describe('job routes refuse a lane token', () => {
  beforeEach(seed);
  const req = (path: string, method = 'GET') =>
    new NextRequest(`https://tower.example.com/api/internal/ai-engine/${path}`, {
      method,
      headers: { Authorization: `Bearer ${LANE}` }
    });

  it('claim → 403', async () => {
    const res = await CLAIM(req('claim', 'POST'));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('LANE_TOKEN_NOT_ACCEPTED');
  });

  it('account-key → 403 and nothing logged', async () => {
    const res = await ACCOUNT_KEY(req('account-key?label=aimech'));
    expect(res.status).toBe(403);
    expect(logs()).toHaveLength(0);
  });

  it('a worker token still reaches claim', async () => {
    const res = await CLAIM(
      new NextRequest('https://tower.example.com/api/internal/ai-engine/claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${WORKER}` }
      })
    );
    expect(res.status).toBe(200);
  });
});

describe('chooseLaneAccount', () => {
  const now = Date.parse('2026-11-11T08:00:00Z');
  const r = (label: string, priority: number, five: number, week: number, ageMin = 5) => ({
    label,
    priority,
    five_hour_util: five,
    seven_day_util: week,
    five_hour_resets_at: new Date(now + 3600_000).toISOString(),
    seven_day_resets_at: new Date(now + 86400_000).toISOString(),
    updated_at: new Date(now - ageMin * 60_000).toISOString()
  });
  const readings = [r('a', 1, 0.5, 0.5), r('b', 2, 0.1, 0.1), r('c', 3, 0.97, 0.2)];

  it('takes priority order among accounts under 95%', () => {
    expect(chooseLaneAccount(readings, ['a', 'b', 'c'], [], new Map(), now)).toEqual({ label: 'a' });
  });

  it('prefers a fresh reading over a stale one', () => {
    const stale = [r('a', 1, 0.1, 0.1, 120), r('b', 2, 0.1, 0.1)];
    expect(chooseLaneAccount(stale, ['a', 'b'], [], new Map(), now)).toEqual({ label: 'b' });
  });

  it('skips a recent refusal but takes it back after 30 minutes', () => {
    const recent = new Map([['a', now - 10 * 60_000]]);
    expect(chooseLaneAccount(readings, ['a', 'b', 'c'], [], recent, now)).toEqual({ label: 'b' });
    const old = new Map([['a', now - LANE_REFUSAL_MS - 1]]);
    expect(chooseLaneAccount(readings, ['a', 'b', 'c'], [], old, now)).toEqual({ label: 'a' });
  });

  it('falls to an account above 95% when the rest were refused', () => {
    expect(chooseLaneAccount(readings, ['a', 'b', 'c'], ['a', 'b'], new Map(), now)).toEqual({ label: 'c' });
  });

  it('returns no account, with the wait until the earliest refusal expires', () => {
    const recent = new Map([['c', now - 25 * 60_000]]);
    expect(chooseLaneAccount(readings, ['a', 'b', 'c'], ['a', 'b'], recent, now)).toEqual({
      label: null,
      retryAfterSeconds: 300
    });
  });

  it('ignores "default"', () => {
    expect(chooseLaneAccount([r('default', 0, 0, 0)], ['default'], [], new Map(), now)).toMatchObject({ label: null });
  });
});
