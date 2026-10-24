import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

/**
 * Worker-file updates through the box agent route: the normal GET lists the
 * published files (no content) and this box's workers; `?file=` serves one
 * allow-listed file with its signature; POST stores what the box runs. A
 * missing ai_box_files table (migration not applied) means "no files".
 */

const TOKEN = 'a'.repeat(40);
const TOKEN_SHA = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
const SHA = 'b'.repeat(64);
const SIG = 'C'.repeat(86) + '==';

const db = vi.hoisted(() => ({
  files: [] as { name: string; sha256: string; signature: string; content: string }[],
  filesError: null as null | { message: string },
  runners: [] as { name: string; last_seen_at: string | null }[],
  upserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; row: Record<string, unknown>; eq: [string, unknown][] }[]
}));

vi.mock('@/lib/ai-engine/accounts', () => ({ resolveBoxAccount: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-engine/account-keys', () => ({ openAccountKey: vi.fn(() => 'secret') }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eqs: [string, unknown][] = [];
      let updateRow: Record<string, unknown> | null = null;
      const result = () => {
        if (table === 'ai_box_files') {
          if (db.filesError) return { data: null, error: db.filesError };
          const name = eqs.find(([c]) => c === 'name')?.[1];
          return { data: name === undefined ? db.files : db.files.filter((f) => f.name === name), error: null };
        }
        if (table === 'ai_runners') return { data: db.runners, error: null };
        if (table === 'ai_jobs') return { data: null, count: 0, error: null };
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        is: () => b,
        in: () => b,
        eq: (c: string, v: unknown) => {
          eqs.push([c, v]);
          if (updateRow) db.updates.push({ table, row: updateRow, eq: [...eqs] });
          return b;
        },
        update: (row: Record<string, unknown>) => {
          updateRow = row;
          return b;
        },
        upsert: async (row: Record<string, unknown>) => {
          db.upserts.push({ table, row });
          return { error: null };
        },
        insert: async () => ({ error: null }),
        maybeSingle: async () => {
          if (table === 'ai_box_agent_tokens') {
            const hit = eqs.some(([c, v]) => c === 'token_sha256' && v === TOKEN_SHA);
            return { data: hit ? { host: 'box-1' } : null, error: null };
          }
          const r = result();
          const rows = (r.data ?? []) as unknown[];
          return { data: r.error ? null : rows[0] ?? null, error: r.error ?? null };
        },
        then: (res: (v: unknown) => unknown) => res(result())
      };
      return b;
    }
  })
}));

const { GET, POST } = await import('@/app/api/internal/ai-engine/box-agent/route');

const URL_BASE = 'https://tower.test/api/internal/ai-engine/box-agent';
function get(query = '', token: string | null = TOKEN) {
  return new NextRequest(`${URL_BASE}${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}
function post(body: unknown, token: string | null = TOKEN) {
  return new NextRequest(URL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
}

describe('box agent route, worker-file updates', () => {
  beforeEach(() => {
    db.files = [{ name: 'jicate-ai-drain.mjs', sha256: SHA, signature: SIG, content: '// worker\n' }];
    db.filesError = null;
    db.runners = [{ name: 'jicate-3', last_seen_at: '2026-10-24T05:00:00.000Z' }];
    db.upserts.length = 0;
    db.updates.length = 0;
  });

  it('GET lists files without content, plus this box\'s workers and server time', async () => {
    const res = await GET(get('?have=default'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.files).toEqual([{ name: 'jicate-ai-drain.mjs', sha256: SHA }]);
    expect(JSON.stringify(body)).not.toContain('// worker');
    expect(JSON.stringify(body)).not.toContain(SIG);
    expect(body.workers).toEqual([{ name: 'jicate-3', last_seen_at: '2026-10-24T05:00:00.000Z' }]);
    expect(Number.isFinite(Date.parse(body.now))).toBe(true);
  });

  it('GET still answers with no files when ai_box_files is not there yet', async () => {
    db.filesError = { message: 'relation "public.ai_box_files" does not exist' };
    const res = await GET(get('?have=default'));
    expect(res.status).toBe(200);
    expect((await res.json()).files).toEqual([]);
  });

  it('GET ignores a row whose name is not allow-listed', async () => {
    db.files.push({ name: 'jicate-box-agent.mjs', sha256: SHA, signature: SIG, content: 'x' });
    const body = await (await GET(get('?have=default'))).json();
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['jicate-ai-drain.mjs']);
  });

  it('?file= serves content and signature for an allowed name', async () => {
    const res = await GET(get('?file=jicate-ai-drain.mjs'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ name: 'jicate-ai-drain.mjs', sha256: SHA, signature: SIG, content: '// worker\n' });
  });

  it('?file= is 404 for a disallowed name, even if a row exists, and for an absent file', async () => {
    db.files.push({ name: 'jicate-box-agent.mjs', sha256: SHA, signature: SIG, content: 'x' });
    expect((await GET(get('?file=jicate-box-agent.mjs'))).status).toBe(404);
    expect((await GET(get('?file=..%2Fjicate-ai-drain.mjs'))).status).toBe(404);
    db.files = [];
    expect((await GET(get('?file=jicate-ai-drain.mjs'))).status).toBe(404);
    db.filesError = { message: 'missing table' };
    expect((await GET(get('?file=jicate-ai-drain.mjs'))).status).toBe(404);
  });

  it('?file= and GET need the agent token', async () => {
    expect((await GET(get('?file=jicate-ai-drain.mjs', null))).status).toBe(401);
    expect((await GET(get('?file=jicate-ai-drain.mjs', 'z'.repeat(40)))).status).toBe(401);
    expect((await GET(get('', null))).status).toBe(401);
  });

  it('POST stores files_applied separately from the account report', async () => {
    const res = await POST(post({ applied: null, files: { 'jicate-ai-drain.mjs': SHA } }));
    expect(res.status).toBe(200);
    expect(db.upserts.find((u) => u.table === 'ai_boxes')?.row).toMatchObject({ host: 'box-1', applied_label: 'default' });
    const upd = db.updates.find((u) => u.table === 'ai_boxes');
    expect(upd?.row).toEqual({ files_applied: { 'jicate-ai-drain.mjs': SHA } });
    expect(upd?.eq).toContainEqual(['host', 'box-1']);
  });

  it('POST without files does not touch files_applied', async () => {
    const res = await POST(post({ applied: 'aimech', restarted: ['ai.jicate.engine-1'] }));
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(0);
  });

  it('POST rejects a bad sha or a file name that is not allow-listed', async () => {
    expect((await POST(post({ applied: null, files: { 'jicate-ai-drain.mjs': 'xyz' } }))).status).toBe(400);
    expect((await POST(post({ applied: null, files: { 'jicate-ai-drain.mjs': SHA.toUpperCase() } }))).status).toBe(400);
    expect((await POST(post({ applied: null, files: { 'jicate-box-agent.mjs': SHA } }))).status).toBe(400);
    expect(db.upserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it('POST needs the agent token', async () => {
    expect((await POST(post({ applied: null }, null))).status).toBe(401);
  });
});
