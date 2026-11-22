import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/internal/ai-engine/complete: a worker's reading, sent with a
 * finished job, is stored as the account's latest AND added to the history of
 * readings (21 Nov 2026). The history is an extra: when it fails, the reading
 * is still stored and the job is still completed.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; row: Row }[],
  history: [] as Row[],
  /** How the history table misbehaves: null = it works. */
  historyFails: null as null | 'missing' | 'down' | 'throws',
  accountsFail: false
}));

vi.mock('@/lib/ai-engine/runner-auth', () => ({
  checkEngineRunnerAuth: vi.fn(async () => ({ ok: true, runner: 'jicate-3' }))
}));
vi.mock('@/lib/ai-engine/engine', () => ({
  readSpecForJob: vi.fn(async () => ({ output_format: 'text', max_answer_words: null })),
  shapeResult: vi.fn((_f: string, _m: number | null, answer: string) => ({ text: answer }))
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: { ok: true, status: 'done' }, error: null }),
    from: (table: string) => {
      const historyError = () => {
        if (table !== 'ai_account_readings' || !db.historyFails) return null;
        if (db.historyFails === 'throws') throw new Error('connection lost');
        return db.historyFails === 'missing' ? { code: '42P01', message: 'no such table' } : { message: 'down' };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        update: (row: Row) => (db.writes.push({ table, op: 'update', row }), b),
        upsert: async (row: Row) => {
          if (table === 'ai_accounts' && db.accountsFail) return { error: { message: 'down' } };
          db.writes.push({ table, op: 'upsert', row });
          return { error: null };
        },
        insert: async (row: Row) => {
          const error = historyError();
          if (error) return { error };
          db.writes.push({ table, op: 'insert', row });
          db.history.push(row);
          return { error: null };
        },
        maybeSingle: async () => ({ data: table === 'ai_jobs' ? { job_type: 'docs.summary' } : null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          new Promise((ok) => {
            const error = historyError();
            const newestFirst = [...db.history].sort((x, y) => (String(x.read_at) < String(y.read_at) ? 1 : -1));
            ok(error ? { data: null, error } : { data: table === 'ai_account_readings' ? newestFirst : [], error: null });
          }).then(res, rej)
      };
      return b;
    }
  })
}));

const { POST } = await import('@/app/api/internal/ai-engine/complete/route');

const JOB = '3f2b8c1e-5a47-4d09-9c3e-6b1f0a2d7e84';
const WEEK_RESET = 1_795_694_400; // epoch seconds, some time ahead
const complete = (usage: Row | undefined) =>
  POST(
    new NextRequest('https://tower.example.com/api/internal/ai-engine/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: JOB, answer: 'ok', usage })
    })
  );
const limits = (over: Row = {}) => ({ seven_day: 0.74, seven_day_resets_at: WEEK_RESET, five_hour: 0.2, five_hour_resets_at: WEEK_RESET - 500_000, ...over });
const written = (table: string) => db.writes.filter((w) => w.table === table);

beforeEach(() => {
  db.writes = [];
  db.history = [];
  db.historyFails = null;
  db.accountsFail = false;
});

describe('a worker reading sent with a finished job', () => {
  it('is stored as the latest reading and added to the history with the same values and time', async () => {
    const res = await complete({ account: 'aiahs', limits: limits() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done' });

    const [latest] = written('ai_accounts');
    const [kept] = written('ai_account_readings');
    expect(latest.op).toBe('upsert');
    expect(kept.op).toBe('insert');
    expect(kept.row).toEqual({
      label: 'aiahs',
      five_hour_util: 0.2,
      seven_day_util: 0.74,
      five_hour_resets_at: new Date((WEEK_RESET - 500_000) * 1000).toISOString(),
      seven_day_resets_at: new Date(WEEK_RESET * 1000).toISOString(),
      reported_by: 'jicate-3',
      read_at: latest.row.updated_at
    });
    // Nothing that is not a reading goes into the history.
    expect(Object.keys(kept.row)).not.toContain('overage_enabled');
    expect(written('ai_account_readings')).toHaveLength(1);
  });

  it('does not add the same values again a moment later, and does add a changed value', async () => {
    await complete({ account: 'aiahs', limits: limits() });
    await complete({ account: 'aiahs', limits: limits() });
    expect(written('ai_account_readings')).toHaveLength(1);
    expect(written('ai_accounts').filter((w) => w.op === 'upsert')).toHaveLength(2);
    await complete({ account: 'aiahs', limits: limits({ seven_day: 0.75 }) });
    expect(written('ai_account_readings').map((w) => w.row.seven_day_util)).toEqual([0.74, 0.75]);
  });

  it('adds nothing when the job carried no reading', async () => {
    expect((await complete({ account: 'aiahs' })).status).toBe(200);
    expect((await complete(undefined)).status).toBe(200);
    expect(written('ai_account_readings')).toEqual([]);
  });

  it('adds nothing to the history when the reading itself could not be stored', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.accountsFail = true;
    expect((await complete({ account: 'aiahs', limits: limits() })).status).toBe(200);
    expect(written('ai_account_readings')).toEqual([]);
    logged.mockRestore();
  });

  it('still stores the reading and completes the job when the history is missing, down, or throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const state of ['missing', 'down', 'throws'] as const) {
        db.writes = [];
        db.historyFails = state;
        const res = await complete({ account: 'aiahs', limits: limits() });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'done' });
        expect(written('ai_accounts').filter((w) => w.op === 'upsert')).toHaveLength(1);
        expect(written('ai_account_readings')).toEqual([]);
      }
    } finally {
      logged.mockRestore();
    }
  });
});
