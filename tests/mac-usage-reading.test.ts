import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { labelsToProbe, PROBE_AFTER_MS } from '@/lib/ai-engine/accounts';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { macReadingRow, MAC_READING_MAX_AGE_MS } from '@/lib/ai-engine/mac-usage';

/**
 * /api/internal/ai-engine/usage-reading: the Mac hands in a free usage reading.
 * Only a "macusage-*" token opens it, and that token opens nothing else. It
 * updates an existing account only (404 otherwise, nothing created), writes
 * only the fields given, never touches ai_account_secrets, keeps a newer
 * reading, and a stored reading stops the watch cron probing that account.
 * A stored reading is also added to the history (21 Nov 2026), and a history
 * failure never fails the reading.
 */

const MAC = 'M'.repeat(64);
const WORKER = 'W'.repeat(64);
const LANE = 'L'.repeat(64);
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  touched: [] as string[],
  writes: [] as { table: string; op: string; row: Row }[],
  /** How the history table (ai_account_readings) misbehaves: null = it works. */
  history: null as null | 'missing' | 'down' | 'throws'
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      db.touched.push(table);
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const historyError = () => {
        if (table !== 'ai_account_readings' || !db.history) return null;
        if (db.history === 'throws') throw new Error('connection lost');
        return db.history === 'missing'
          ? { code: 'PGRST205', message: "Could not find the table 'public.ai_account_readings' in the schema cache" }
          : { code: '57014', message: 'down' };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        update: (row: Row) => ((patch = row), b),
        upsert: async (row: Row) => (db.writes.push({ table, op: 'upsert', row }), { error: null }),
        insert: async (row: Row) => {
          const error = historyError();
          if (error) return { error };
          db.writes.push({ table, op: 'insert', row });
          (db.tables[table] ??= []).push({ ...row });
          return { error: null };
        },
        // The history's "newest row of this account" read: newest first.
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          new Promise((ok) => {
            const error = historyError();
            const newestFirst = [...rows()].sort((x, y) => (String(x.read_at) < String(y.read_at) ? 1 : -1));
            ok(error ? { data: null, error } : { data: newestFirst, error: null });
          }).then(res, rej),
        maybeSingle: async () => {
          const hit = rows()[0] ?? null;
          if (patch && hit) {
            Object.assign(hit, patch);
            db.writes.push({ table, op: 'update', row: patch });
          }
          return { data: hit, error: null };
        }
      };
      return b;
    }
  })
}));

const { POST } = await import('@/app/api/internal/ai-engine/usage-reading/route');

const NOW_S = () => Math.floor(Date.now() / 1000);
const req = (body: unknown, token = MAC) =>
  new NextRequest('http://x/api/internal/ai-engine/usage-reading', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
const reading = (over: Row = {}) => ({
  label: 'ainursing',
  seven_day_util: 1,
  seven_day_resets_at: NOW_S() + 3 * 86400,
  read_at: NOW_S() - 60,
  source: 'mac',
  ...over
});
const account = (label: string) => db.tables.ai_accounts.find((r) => r.label === label)!;

let FH_RESET = '';
beforeEach(() => {
  FH_RESET = new Date(Date.now() + 60 * 60_000).toISOString();
  db.touched = [];
  db.writes = [];
  db.history = null;
  db.tables = {
    ai_runner_tokens: [
      { runner: 'macusage-mac', token_sha256: sha(MAC), revoked_at: null },
      { runner: 'box1-w1', token_sha256: sha(WORKER), revoked_at: null },
      { runner: 'maxlane-box1', token_sha256: sha(LANE), revoked_at: null }
    ],
    ai_accounts: [
      {
        label: 'ainursing',
        priority: 2,
        five_hour_util: 0.3,
        seven_day_util: 0.96,
        five_hour_resets_at: FH_RESET,
        seven_day_resets_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        overage_enabled: false,
        reported_by: 'box1-w1',
        updated_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString()
      },
      { label: 'aimech', priority: 1, updated_at: null }
    ]
  };
});

describe('who may use it', () => {
  it('refuses a worker token and a lane token', async () => {
    for (const t of [WORKER, LANE]) {
      const res = await POST(req(reading(), t));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('NOT_A_USAGE_TOKEN');
    }
    expect(db.writes).toEqual([]);
  });

  it('refuses no token and an unknown token', async () => {
    expect((await POST(req(reading(), ''))).status).toBe(401);
    expect((await POST(req(reading(), 'X'.repeat(64)))).status).toBe(401);
  });

  it('the Mac token is refused on the job routes and the lane route', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient() as never;
    const r = () => new Request('http://x', { headers: { authorization: `Bearer ${MAC}` } });
    const job = await checkEngineRunnerAuth(r(), admin);
    expect(job.ok).toBe(false);
    if (!job.ok) {
      expect(job.response.status).toBe(403);
      expect((await job.response.json()).error.code).toBe('USAGE_TOKEN_NOT_ACCEPTED');
    }
    const lane = await checkEngineRunnerAuth(r(), admin, { lane: true });
    expect(lane.ok).toBe(false);
    if (!lane.ok) expect((await lane.response.json()).error.code).toBe('NOT_A_LANE_TOKEN');
  });

  it('worker and lane tokens still pass where they did', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient() as never;
    const r = (t: string) => new Request('http://x', { headers: { authorization: `Bearer ${t}` } });
    expect(await checkEngineRunnerAuth(r(WORKER), admin)).toEqual({ ok: true, runner: 'box1-w1' });
    expect(await checkEngineRunnerAuth(r(LANE), admin, { lane: true })).toEqual({ ok: true, runner: 'maxlane-box1' });
  });
});

describe('what it writes', () => {
  it('stores the weekly reading of an existing account, stamped with when the Mac read it', async () => {
    const body = reading();
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'stored' });
    const a = account('ainursing');
    expect(a.seven_day_util).toBe(1);
    expect(a.seven_day_resets_at).toBe(new Date(body.seven_day_resets_at * 1000).toISOString());
    expect(a.updated_at).toBe(new Date(body.read_at * 1000).toISOString());
    expect(a.reported_by).toBe('macusage-mac');
  });

  it('leaves the 5-hour reading, overage and priority alone when the Mac has no 5-hour number', async () => {
    await POST(req(reading()));
    const a = account('ainursing');
    expect(a.five_hour_util).toBe(0.3);
    expect(a.five_hour_resets_at).toBe(FH_RESET);
    expect(a.overage_enabled).toBe(false);
    expect(a.priority).toBe(2);
  });

  it('stores the 5-hour reading when given', async () => {
    const at = NOW_S() + 3600;
    await POST(req(reading({ five_hour_util: 0.11, five_hour_resets_at: at })));
    expect(account('ainursing').five_hour_util).toBe(0.11);
    expect(account('ainursing').five_hour_resets_at).toBe(new Date(at * 1000).toISOString());
  });

  it('fills an account that never had a reading', async () => {
    expect((await (await POST(req(reading({ label: 'aimech' })))).json()).status).toBe('stored');
    expect(account('aimech').seven_day_util).toBe(1);
  });

  it('never creates an account and never touches the keys table', async () => {
    const res = await POST(req(reading({ label: 'director' })));
    expect(res.status).toBe(404);
    expect(db.tables.ai_accounts.map((r) => r.label)).toEqual(['ainursing', 'aimech']);
    expect(db.writes).toEqual([]);
    await POST(req(reading()));
    expect(db.touched).not.toContain('ai_account_secrets');
    // The reading itself is an update of the account; the only other write is its history row.
    expect(db.writes.map((w) => `${w.op} ${w.table}`)).toEqual(['update ai_accounts', 'insert ai_account_readings']);
  });

  it('keeps a newer stored reading', async () => {
    account('ainursing').updated_at = new Date().toISOString();
    const res = await POST(req(reading()));
    expect(await res.json()).toEqual({ status: 'kept_newer' });
    expect(db.writes).toEqual([]);
    expect(account('ainursing').seven_day_util).toBe(0.96);
  });

  it('re-sending the same reading changes nothing', async () => {
    const body = reading();
    await POST(req(body));
    db.writes = [];
    expect(await (await POST(req(body))).json()).toEqual({ status: 'kept_newer' });
    expect(db.writes).toEqual([]);
  });

  it('refuses a stale or future reading, and a bad body', async () => {
    const stale = await POST(req(reading({ read_at: NOW_S() - 21 * 60 })));
    expect(stale.status).toBe(422);
    expect((await stale.json()).error.code).toBe('STALE_READING');
    const future = await POST(req(reading({ read_at: NOW_S() + 10 * 60 })));
    expect((await future.json()).error.code).toBe('FUTURE_READING');
    for (const bad of [
      reading({ label: 'default' }),
      reading({ label: 'auto' }),
      reading({ label: 'Bad Label' }),
      reading({ source: 'box' }),
      reading({ seven_day_util: -0.1 }),
      reading({ seven_day_resets_at: undefined })
    ]) {
      expect((await POST(req(bad))).status).toBe(400);
    }
    expect(db.writes).toEqual([]);
  });
});

describe('the history of readings (21 Nov 2026)', () => {
  const history = () => db.writes.filter((w) => w.table === 'ai_account_readings');

  it('adds a stored reading to the history, stamped with when the Mac read it', async () => {
    const body = reading();
    expect(await (await POST(req(body))).json()).toEqual({ status: 'stored' });
    expect(history()).toHaveLength(1);
    expect(history()[0].row).toEqual({
      label: 'ainursing',
      five_hour_util: null,
      seven_day_util: 1,
      five_hour_resets_at: null,
      seven_day_resets_at: new Date(body.seven_day_resets_at * 1000).toISOString(),
      reported_by: 'macusage-mac',
      read_at: new Date(body.read_at * 1000).toISOString()
    });
  });

  it('keeps the 5-hour number in the history when the Mac gave one', async () => {
    const at = NOW_S() + 3600;
    await POST(req(reading({ five_hour_util: 0.11, five_hour_resets_at: at })));
    expect(history()[0].row).toMatchObject({ five_hour_util: 0.11, five_hour_resets_at: new Date(at * 1000).toISOString() });
  });

  it('adds nothing for a reading that was not stored', async () => {
    account('ainursing').updated_at = new Date().toISOString();
    expect(await (await POST(req(reading()))).json()).toEqual({ status: 'kept_newer' });
    await POST(req(reading({ label: 'director' })));
    await POST(req(reading({ read_at: NOW_S() - 21 * 60 })));
    expect(history()).toEqual([]);
  });

  it('does not add the same values twice within 10 minutes, and does add a changed value', async () => {
    await POST(req(reading({ seven_day_util: 0.5, read_at: NOW_S() - 300 })));
    await POST(req(reading({ seven_day_util: 0.5, read_at: NOW_S() - 120 })));
    expect(history()).toHaveLength(1);
    await POST(req(reading({ seven_day_util: 0.51, read_at: NOW_S() - 60 })));
    expect(history().map((w) => w.row.seven_day_util)).toEqual([0.5, 0.51]);
    // Both later readings were still stored as the account's latest.
    expect(account('ainursing').seven_day_util).toBe(0.51);
  });

  it('still stores the reading when the history table does not exist yet, cannot be reached, or throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const state of ['missing', 'down', 'throws'] as const) {
        db.history = state;
        account('ainursing').updated_at = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
        const res = await POST(req(reading({ seven_day_util: 0.7 })));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'stored' });
        expect(account('ainursing').seven_day_util).toBe(0.7);
      }
      expect(history()).toEqual([]);
      // A table that is simply not there yet is not worth a log line; the other two are.
      expect(logged).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('review fixes (W12, PR #97)', () => {
  const status = async (body: unknown) => (await POST(req(body))).status;

  it('1. a reading without read_at is refused with 400, not treated as fresh', async () => {
    const body: Row = reading();
    delete body.read_at;
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
    expect(await status(reading({ read_at: null }))).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it('2. a reset time more than 8 days ahead is a 400, never a 500', async () => {
    expect(await status(reading({ seven_day_resets_at: 1e15 }))).toBe(400);
    expect(await status(reading({ seven_day_resets_at: Number.MAX_SAFE_INTEGER }))).toBe(400);
    expect(await status(reading({ seven_day_resets_at: NOW_S() + 9 * 86400 }))).toBe(400);
    expect(await status(reading({ five_hour_util: 0.1, five_hour_resets_at: 1e15 }))).toBe(400);
    expect(db.writes).toEqual([]);
    expect(await status(reading({ seven_day_resets_at: NOW_S() + 7 * 86400 + 3600 }))).toBe(200);
  });

  it('3. the 5-hour number and its reset time come together or not at all', async () => {
    expect(await status(reading({ five_hour_util: 0.2 }))).toBe(400);
    expect(await status(reading({ five_hour_resets_at: NOW_S() + 3600 }))).toBe(400);
    expect(await status(reading({ five_hour_util: 0.2, five_hour_resets_at: null }))).toBe(400);
    expect(db.writes).toEqual([]);
    expect(await status(reading({ five_hour_util: null, five_hour_resets_at: null }))).toBe(200);
    expect(account('ainursing').five_hour_util).toBe(0.3);
  });

  it('4. utilisation is capped at 1 (the scale is 0-1)', async () => {
    expect(await status(reading({ seven_day_util: 1.01 }))).toBe(400);
    expect(await status(reading({ seven_day_util: 10 }))).toBe(400);
    expect(await status(reading({ five_hour_util: 1.5, five_hour_resets_at: NOW_S() + 3600 }))).toBe(400);
    expect(db.writes).toEqual([]);
    expect(await status(reading({ seven_day_util: 1 }))).toBe(200);
  });
});

describe('a Mac reading stops the paid probe', () => {
  it('a full account with a fresh Mac reading is not probed; without one it is not probed either, but stays stale', async () => {
    const now = Date.now();
    const labels = ['default', 'ainursing', 'aimech'];
    // Before: ainursing read 2 h ago at 96% → skipped as full, so its number never refreshes.
    expect(labelsToProbe(db.tables.ai_accounts as never, labels, now)).toEqual(['aimech']);
    await POST(req(reading()));
    await POST(req(reading({ label: 'aimech', seven_day_util: 0.85 })));
    // After: both have a reading under 15 minutes old → no probe job for either.
    expect(labelsToProbe(db.tables.ai_accounts as never, labels, now)).toEqual([]);
    // 15 minutes on, aimech (not full) is due again unless the Mac pushed since.
    expect(labelsToProbe(db.tables.ai_accounts as never, labels, now + PROBE_AFTER_MS + 60_000)).toEqual(['aimech']);
  });
});

describe('macReadingRow', () => {
  const now = Date.parse('2026-11-18T07:30:00Z');
  const base = {
    label: 'aimech',
    seven_day_util: 0.85,
    seven_day_resets_at: 1_800_000_000,
    read_at: Math.floor(now / 1000) - 60,
    source: 'mac' as const
  };

  it('stamps updated_at with read_at', () => {
    const out = macReadingRow(base, 'macusage-mac', now);
    expect(out.ok && out.row.updated_at).toBe('2026-11-18T07:29:00.000Z');
  });

  it('accepts a reading exactly 20 minutes old, refuses one a second older', () => {
    const at = (ms: number) => ({ ...base, read_at: Math.floor((now - ms) / 1000) });
    expect(macReadingRow(at(MAC_READING_MAX_AGE_MS), 'm', now).ok).toBe(true);
    expect(macReadingRow(at(MAC_READING_MAX_AGE_MS + 1000), 'm', now)).toEqual({ ok: false, reason: 'stale' });
  });

  it('omits 5-hour fields that were not given', () => {
    const out = macReadingRow({ ...base, five_hour_util: null }, 'm', now);
    expect(out.ok && Object.keys(out.row).sort()).toEqual(
      ['reported_by', 'seven_day_resets_at', 'seven_day_util', 'updated_at'].sort()
    );
  });
});

describe('labelsToProbe and updated_at', () => {
  it('skips any account whose reading is under 15 minutes old, full or not', () => {
    const now = Date.parse('2026-11-18T07:30:00Z');
    const r = (label: string, week: number, agoMs: number) => ({
      label,
      priority: 1,
      five_hour_util: null,
      seven_day_util: week,
      five_hour_resets_at: null,
      seven_day_resets_at: '2026-11-20T00:00:00Z',
      updated_at: new Date(now - agoMs).toISOString()
    });
    const readings = [r('full', 1, 5 * 60_000), r('half', 0.5, 5 * 60_000), r('old', 0.5, PROBE_AFTER_MS + 1)];
    expect(labelsToProbe(readings, ['full', 'half', 'old'], now)).toEqual(['old']);
  });
});
