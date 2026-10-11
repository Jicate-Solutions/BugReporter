import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

/**
 * The email-scoped reporter routes must refuse any call that lacks the app's
 * server key, and submitting a bug must not need one.
 *
 * Supabase is replaced by an in-memory fake: no network, no database.
 */

const PUBLIC_KEY = 'test-public-key';
const SERVER_KEY = 'brs_test-server-key';
const SERVER_KEY_HASH = createHash('sha256').update(SERVER_KEY).digest('hex');
const APP_ID = '00000000-0000-0000-0000-0000000000a1';
const BUG_ID = '00000000-0000-0000-0000-0000000000b1';
const EMAIL = 'reporter@example.com';

type Result = { data: unknown; error: unknown; count?: number };

const db = vi.hoisted(() => ({
  /** What applications.server_key_hash holds. undefined = column missing (migration not applied). */
  serverKeyHash: null as string | null | undefined,
  /** Every server_key_hash lookup, so a test can prove submit never made one. */
  serverKeyLookups: 0,
}));

vi.mock('@supabase/supabase-js', () => {
  function query(table: string) {
    let cols = '';
    let op = 'select';
    const q: Record<string, unknown> = {};
    const chain = (name: string) =>
      (...args: unknown[]) => {
        if (name === 'select' && op === 'select') cols = String(args[0] ?? '');
        if (['insert', 'update', 'upsert', 'delete'].includes(name)) op = name;
        return q;
      };
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'order', 'range', 'limit', 'insert', 'update', 'upsert', 'delete']) {
      q[m] = chain(m);
    }
    const one = async (): Promise<Result> => {
      if (table === 'applications' && cols.includes('api_key')) {
        return {
          data: {
            id: APP_ID,
            name: 'Test App',
            slug: 'test-app',
            organization_id: 'org-1',
            api_key: PUBLIC_KEY,
            created_at: '2026-01-01T00:00:00Z',
            settings: {},
            organizations: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
          },
          error: null,
        };
      }
      if (table === 'applications' && cols === 'server_key_hash') {
        db.serverKeyLookups += 1;
        if (db.serverKeyHash === undefined) {
          return { data: null, error: { code: '42703', message: 'column applications.server_key_hash does not exist' } };
        }
        return { data: { server_key_hash: db.serverKeyHash }, error: null };
      }
      if (table === 'bug_reports' && op === 'insert') {
        return { data: { id: BUG_ID, display_id: 'BUG-1' }, error: null };
      }
      // Any lookup of a specific bug: "not found", which proves the handler ran.
      return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    };
    q.single = one;
    q.maybeSingle = one;
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
    return q;
  }
  return {
    createClient: () => ({
      from: (table: string) => query(table),
      rpc: async () => ({ data: null, error: null }),
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    }),
  };
});

vi.mock('@/lib/services/email/email.service', () => ({
  EmailService: { sendNewBugNotification: vi.fn(async () => undefined) },
}));
vi.mock('@/lib/services/notifications/app-owner', () => ({
  resolveAppOwnerRecipient: vi.fn(async () => null),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role';
delete process.env.OPENAI_API_KEY;

const me = await import('@/app/api/v1/public/bug-reports/me/route');
const stats = await import('@/app/api/v1/public/bug-reports/stats/route');
const byId = await import('@/app/api/v1/public/bug-reports/[id]/route');
const messages = await import('@/app/api/v1/public/bug-reports/[id]/messages/route');
const status = await import('@/app/api/v1/public/bug-reports/[id]/status/route');
const submit = await import('@/app/api/v1/public/bug-reports/route');
const { PUBLIC_CORS_HEADERS } = await import('@/lib/middleware/api-key-auth');
const { serverKeyMatches } = await import('@/lib/middleware/server-key-auth');

type Handler = (
  req: NextRequest,
  ctx?: { params: Promise<Record<string, string>> }
) => Promise<Response>;

const BASE = 'https://bugs.example.com/api/v1/public/bug-reports';
const q = `reporter_email=${encodeURIComponent(EMAIL)}`;

interface Case {
  name: string;
  handler: Handler;
  method: string;
  url: string;
  body?: unknown;
  /** Status the handler itself answers once past the guard, given the fake DB. */
  okStatus: number;
}

const CASES: Case[] = [
  { name: 'GET /me', handler: me.GET as Handler, method: 'GET', url: `${BASE}/me?${q}`, okStatus: 200 },
  { name: 'GET /stats', handler: stats.GET as Handler, method: 'GET', url: `${BASE}/stats?${q}`, okStatus: 200 },
  { name: 'GET /:id', handler: byId.GET as Handler, method: 'GET', url: `${BASE}/${BUG_ID}?${q}`, okStatus: 404 },
  { name: 'PATCH /:id', handler: byId.PATCH as Handler, method: 'PATCH', url: `${BASE}/${BUG_ID}`, body: { resolution_notes: 'hi', reporter_email: EMAIL }, okStatus: 0 },
  { name: 'GET /:id/messages', handler: messages.GET as Handler, method: 'GET', url: `${BASE}/${BUG_ID}/messages?${q}`, okStatus: 404 },
  { name: 'POST /:id/messages', handler: messages.POST as Handler, method: 'POST', url: `${BASE}/${BUG_ID}/messages`, body: { message: 'hi', reporter_email: EMAIL }, okStatus: 0 },
  { name: 'POST /:id/status', handler: status.POST as Handler, method: 'POST', url: `${BASE}/${BUG_ID}/status`, body: { status: 'closed', reporter_email: EMAIL }, okStatus: 0 },
];

function call(c: Case, headers: Record<string, string>) {
  const req = new NextRequest(c.url, {
    method: c.method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
  return c.handler(req, { params: Promise.resolve({ id: BUG_ID }) });
}

async function errorCode(res: Response) {
  const json = (await res.json()) as { error?: { code?: string; message?: string } };
  return json.error;
}

beforeEach(() => {
  db.serverKeyHash = SERVER_KEY_HASH;
  db.serverKeyLookups = 0;
});

describe.each(CASES)('$name', (c) => {
  it('refuses with no server key', async () => {
    const res = await call(c, { 'X-API-Key': PUBLIC_KEY });
    expect(res.status).toBe(401);
    const err = await errorCode(res);
    expect(err?.code).toBe('SERVER_KEY_REQUIRED');
    expect(err?.message).toMatch(/server key, not from a browser/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('refuses with a wrong server key', async () => {
    const res = await call(c, { 'X-API-Key': PUBLIC_KEY, 'X-Server-Key': 'brs_wrong' });
    expect(res.status).toBe(401);
    expect((await errorCode(res))?.code).toBe('INVALID_SERVER_KEY');
  });

  it('refuses when the app has no server key set', async () => {
    db.serverKeyHash = null;
    const res = await call(c, { 'X-API-Key': PUBLIC_KEY, 'X-Server-Key': SERVER_KEY });
    expect(res.status).toBe(401);
    expect((await errorCode(res))?.code).toBe('INVALID_SERVER_KEY');
  });

  it('refuses when the migration is not applied (column missing)', async () => {
    db.serverKeyHash = undefined;
    const res = await call(c, { 'X-API-Key': PUBLIC_KEY, 'X-Server-Key': SERVER_KEY });
    expect(res.status).toBe(401);
  });

  it('still requires the public API key', async () => {
    const res = await call(c, { 'X-Server-Key': SERVER_KEY });
    expect(res.status).toBe(401);
    expect((await errorCode(res))?.code).toBe('MISSING_API_KEY');
  });

  it('passes through to the handler with the right server key', async () => {
    const res = await call(c, { 'X-API-Key': PUBLIC_KEY, 'X-Server-Key': SERVER_KEY });
    expect(res.status).not.toBe(401);
    if (c.okStatus) expect(res.status).toBe(c.okStatus);
    expect(db.serverKeyLookups).toBe(1);
  });
});

describe('submit (POST /api/v1/public/bug-reports)', () => {
  it('works from a browser with only the public key, and never looks up a server key', async () => {
    db.serverKeyHash = undefined; // even with the migration unapplied
    const req = new NextRequest(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': PUBLIC_KEY },
      body: JSON.stringify({ title: 't', description: 'd', page_url: 'https://app.example.com/x' }),
    });
    const res = await (submit.POST as Handler)(req);
    expect(res.status).toBe(201);
    expect(db.serverKeyLookups).toBe(0);
  });
});

describe('CORS', () => {
  it('does not allow X-Server-Key from a browser', () => {
    expect(PUBLIC_CORS_HEADERS['Access-Control-Allow-Headers'].toLowerCase()).not.toContain('x-server-key');
  });
});

describe('serverKeyMatches', () => {
  it('matches only the exact key', () => {
    expect(serverKeyMatches(SERVER_KEY, SERVER_KEY_HASH)).toBe(true);
    expect(serverKeyMatches(SERVER_KEY + 'x', SERVER_KEY_HASH)).toBe(false);
    expect(serverKeyMatches(SERVER_KEY, null)).toBe(false);
    expect(serverKeyMatches(SERVER_KEY, 'not-a-hash')).toBe(false);
    expect(serverKeyMatches(SERVER_KEY, SERVER_KEY_HASH.toUpperCase())).toBe(false);
  });
});
