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
 */

const MAC = 'M'.repeat(64);
const WORKER = 'W'.repeat(64);
const LANE = 'L'.repeat(64);
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  touched: [] as string[],
  writes: [] as { table: string; op: string; row: Row }[]
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      db.touched.push(table);
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        update: (row: Row) => ((patch = row), b),
        upsert: async (row: Row) => (db.writes.push({ table, op: 'upsert', row }), { error: null }),
        insert: async (row: Row) => (db.writes.push({ table, op: 'insert', row }), { error: null }),
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
    expect(db.writes.every((w) => w.op === 'update' && w.table === 'ai_accounts')).toBe(true);
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
  const base = { label: 'aimech', seven_day_util: 0.85, seven_day_resets_at: 1_800_000_000, source: 'mac' as const };

  it('uses now when read_at is missing', () => {
    const out = macReadingRow(base, 'macusage-mac', now);
    expect(out.ok && out.row.updated_at).toBe('2026-11-18T07:30:00.000Z');
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
