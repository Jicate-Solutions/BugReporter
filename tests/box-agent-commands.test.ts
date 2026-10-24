import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

/**
 * Remote control through the box agent route: GET hands this box its queued,
 * unexpired commands (oldest first, at most 5) after marking its stale ones
 * expired; POST command_update moves only this box's rows and never a
 * terminal one; POST status_report lands on ai_boxes. A command update alone
 * must not overwrite the applied account.
 *
 * The admin client is an in-memory table store that really applies the
 * filters the route uses, so scoping is tested, not assumed.
 */

const TOKEN = 'a'.repeat(40);
const TOKEN_SHA = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
const SIG = 'C'.repeat(86) + '==';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  upserts: [] as { table: string; row: Row }[]
}));

vi.mock('@/lib/ai-engine/accounts', () => ({ resolveBoxAccount: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({ openAccountKey: vi.fn(() => 'secret') }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let order: { col: string; asc: boolean } | null = null;
      let limit = Infinity;
      let count = false;
      const missing = () => db.missing.has(table);
      const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (missing()) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        if (table === 'ai_box_agent_tokens') return { data: null, error: null };
        let hit = rows();
        if (patch) {
          for (const r of hit) Object.assign(r, patch);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (order) {
          const { col, asc } = order;
          hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
        }
        hit = hit.slice(0, limit);
        return count ? { data: null, count: hit.length, error: null } : { data: hit, error: null };
      };
      const b: Record<string, unknown> = {
        select: (_c?: string, opts?: { count?: string }) => {
          if (opts?.count) count = true;
          return b;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
        lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), b),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
        order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
        limit: (n: number) => ((limit = n), b),
        update: (row: Row) => ((patch = row), b),
        upsert: async (row: Row) => {
          db.upserts.push({ table, row });
          return { error: null };
        },
        insert: async () => ({ error: null }),
        maybeSingle: async () => {
          if (table === 'ai_box_agent_tokens') {
            const ok = filters.length > 0 && rows().length > 0;
            return { data: ok ? { host: 'box-1' } : null, error: null };
          }
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
const get = (q = '?have=default') => new NextRequest(`${URL_BASE}${q}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const post = (body: unknown, token = TOKEN) =>
  new NextRequest(URL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60000).toISOString();
let n = 0;
function cmd(over: Row = {}): Row {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    box: 'box-1',
    verb: 'status',
    payload: `{"id":"${id}"}`,
    signature: SIG,
    status: 'queued',
    expires_at: iso(30),
    created_at: iso(-n),
    started_at: null,
    finished_at: null,
    result: null,
    ...over
  };
}
const commands = () => db.tables.ai_box_commands;
const byId = (id: unknown) => commands().find((r) => r.id === id)!;

beforeEach(() => {
  n = 0;
  db.missing.clear();
  db.upserts.length = 0;
  db.tables = {
    ai_box_agent_tokens: [{ token_sha256: TOKEN_SHA, host: 'box-1', revoked_at: null }],
    ai_box_files: [],
    ai_runners: [],
    ai_jobs: [],
    ai_boxes: [{ host: 'box-1', applied_label: 'aimech' }, { host: 'box-2', applied_label: 'aimech' }],
    ai_box_commands: []
  };
});

describe('GET commands', () => {
  it('lists only this box\'s queued, unexpired commands, oldest first, at most 5, signed bytes only', async () => {
    const mine = Array.from({ length: 7 }, () => cmd());
    commands().push(
      ...mine,
      cmd({ box: 'box-2' }),
      cmd({ status: 'running' }),
      cmd({ status: 'done' })
    );
    const body = await (await GET(get())).json();
    expect(body.commands).toHaveLength(5);
    // created_at = now - n minutes, so the highest n is oldest.
    const oldestFirst = [...mine].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    expect(body.commands.map((c: Row) => c.id)).toEqual(oldestFirst.slice(0, 5).map((c) => c.id));
    expect(Object.keys(body.commands[0]).sort()).toEqual(['id', 'payload', 'signature', 'verb']);
  });

  it('marks this box\'s queued rows past expiry as expired, and leaves other boxes alone', async () => {
    const stale = cmd({ expires_at: iso(-1) });
    const otherStale = cmd({ box: 'box-2', expires_at: iso(-1) });
    const runningStale = cmd({ status: 'running', expires_at: iso(-1) });
    const fresh = cmd();
    commands().push(stale, otherStale, runningStale, fresh);
    const body = await (await GET(get())).json();
    expect(body.commands.map((c: Row) => c.id)).toEqual([fresh.id]);
    expect(byId(stale.id).status).toBe('expired');
    expect(byId(stale.id).finished_at).toBeTruthy();
    expect(byId(otherStale.id).status).toBe('queued');
    expect(byId(runningStale.id).status).toBe('running');
  });

  it('fails this box\'s running rows 10+ minutes past expiry (agent stopped), and nothing else', async () => {
    const dead = cmd({ status: 'running', expires_at: iso(-11), started_at: iso(-40) });
    const graceLeft = cmd({ status: 'running', expires_at: iso(-9), started_at: iso(-40) });
    const otherDead = cmd({ box: 'box-2', status: 'running', expires_at: iso(-11) });
    const doneOld = cmd({ status: 'done', expires_at: iso(-60), result: { exit: 0 } });
    commands().push(dead, graceLeft, otherDead, doneOld);
    expect((await GET(get())).status).toBe(200);
    expect(byId(dead.id)).toMatchObject({ status: 'failed', result: { reason: 'agent stopped' } });
    expect(byId(dead.id).finished_at).toBeTruthy();
    expect(byId(graceLeft.id).status).toBe('running');
    expect(byId(otherDead.id).status).toBe('running');
    expect(byId(doneOld.id)).toMatchObject({ status: 'done', result: { exit: 0 } });
    // A late report from the agent cannot move it back.
    const res = await POST(post({ command_update: { id: dead.id, status: 'done', result: { exit: 0 } } }));
    expect((await res.json()).command.moved).toBe(false);
    expect(byId(dead.id).status).toBe('failed');
  });

  it('answers with no commands when ai_box_commands is not there yet', async () => {
    db.missing.add('ai_box_commands');
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect((await res.json()).commands).toEqual([]);
  });

  it('?file= serves a newly allowed name (the agent itself)', async () => {
    db.tables.ai_box_files.push({ name: 'jicate-box-agent.mjs', sha256: 'b'.repeat(64), signature: SIG, content: 'x' });
    expect((await GET(get('?file=jicate-box-agent.mjs'))).status).toBe(200);
  });
});

describe('POST command_update', () => {
  it('running sets started_at; done sets finished_at and result', async () => {
    const c = cmd();
    commands().push(c);
    let res = await POST(post({ command_update: { id: c.id, status: 'running' } }));
    expect(await res.json()).toEqual({ ok: true, command: { id: c.id, moved: true } });
    expect(byId(c.id)).toMatchObject({ status: 'running', finished_at: null });
    expect(byId(c.id).started_at).toBeTruthy();
    res = await POST(post({ command_update: { id: c.id, status: 'done', result: { exit: 0 } } }));
    expect((await res.json()).command.moved).toBe(true);
    expect(byId(c.id)).toMatchObject({ status: 'done', result: { exit: 0 } });
    expect(byId(c.id).finished_at).toBeTruthy();
  });

  it('never moves a terminal row', async () => {
    const rows = ['done', 'failed', 'refused', 'expired'].map((status) => cmd({ status }));
    commands().push(...rows);
    for (const r of rows) {
      for (const status of ['running', 'done', 'failed', 'refused']) {
        const res = await POST(post({ command_update: { id: r.id, status } }));
        expect((await res.json()).command.moved).toBe(false);
      }
      expect(byId(r.id).status).toBe(r.status);
    }
  });

  it('running only from queued (a running row cannot restart)', async () => {
    const c = cmd({ status: 'running', started_at: '2026-10-24T00:00:00.000Z' });
    commands().push(c);
    const res = await POST(post({ command_update: { id: c.id, status: 'running' } }));
    expect((await res.json()).command.moved).toBe(false);
    expect(byId(c.id).started_at).toBe('2026-10-24T00:00:00.000Z');
  });

  it('cannot move another box\'s command', async () => {
    const theirs = cmd({ box: 'box-2' });
    commands().push(theirs);
    const res = await POST(post({ command_update: { id: theirs.id, status: 'refused', result: { reason: 'x' } } }));
    expect((await res.json()).command.moved).toBe(false);
    expect(byId(theirs.id).status).toBe('queued');
  });

  it('a command update alone does not touch the applied account', async () => {
    const c = cmd();
    commands().push(c);
    await POST(post({ command_update: { id: c.id, status: 'running' } }));
    const up = db.upserts.find((u) => u.table === 'ai_boxes')!;
    expect(up.row).toEqual({ host: 'box-1', agent_seen_at: expect.any(String) });
  });

  it('rejects expired as an agent status, a bad id, or an oversize result', async () => {
    const c = cmd();
    commands().push(c);
    expect((await POST(post({ command_update: { id: c.id, status: 'expired' } }))).status).toBe(400);
    expect((await POST(post({ command_update: { id: 'nope', status: 'done' } }))).status).toBe(400);
    const big = 'x'.repeat(130 * 1024);
    expect((await POST(post({ command_update: { id: c.id, status: 'done', result: { big } } }))).status).toBe(400);
    expect(byId(c.id).status).toBe('queued');
  });

  it('needs the agent token', async () => {
    expect((await POST(post({ status_report: {} }, 'z'.repeat(40)))).status).toBe(401);
  });
});

describe('POST status_report', () => {
  it('stores the report and status_at on this box only', async () => {
    const report = { host: 'box-1', node: 'v22', disk_free_gb: 40 };
    const res = await POST(post({ status_report: report }));
    expect(res.status).toBe(200);
    const [mine, theirs] = db.tables.ai_boxes;
    expect(mine.status_report).toEqual(report);
    expect(mine.status_at).toBeTruthy();
    expect(theirs.status_report).toBeUndefined();
  });

  it('can be combined with the account report and a command update', async () => {
    const c = cmd();
    commands().push(c);
    const res = await POST(post({ applied: 'aimech', status_report: { a: 1 }, command_update: { id: c.id, status: 'done', result: { a: 1 } } }));
    expect(res.status).toBe(200);
    expect(db.upserts[0].row).toMatchObject({ host: 'box-1', applied_label: 'aimech' });
    expect(byId(c.id).status).toBe('done');
    expect(db.tables.ai_boxes[0].status_report).toEqual({ a: 1 });
  });

  it('rejects an empty body and an array report', async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ status_report: [1, 2] }))).status).toBe(400);
    expect(db.upserts).toHaveLength(0);
  });
});
