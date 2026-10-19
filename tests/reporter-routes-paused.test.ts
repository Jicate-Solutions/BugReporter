import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Kill switch: the email-scoped reporter routes answer 503 before touching
 * the database, and submitting a bug still works.
 */

const BUG_ID = '00000000-0000-0000-0000-0000000000b1';

const db = vi.hoisted(() => ({ createClientCalls: 0 }));

vi.mock('@supabase/supabase-js', () => {
  function query(table: string) {
    let cols = '';
    let op = 'select';
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'range', 'limit', 'insert', 'update']) {
      q[m] = (...args: unknown[]) => {
        if (m === 'select' && op === 'select') cols = String(args[0] ?? '');
        if (m === 'insert' || m === 'update') op = m;
        return q;
      };
    }
    q.single = async () => {
      if (table === 'applications' && cols.includes('api_key')) {
        return {
          data: {
            id: 'app-1', name: 'Test App', slug: 'test-app', organization_id: 'org-1',
            created_at: '2026-01-01T00:00:00Z', settings: {},
            organizations: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
          },
          error: null,
        };
      }
      if (table === 'bug_reports' && op === 'insert') {
        return { data: { id: BUG_ID }, error: null };
      }
      return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    };
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return q;
  }
  return {
    createClient: () => {
      db.createClientCalls += 1;
      return { from: (t: string) => query(t) };
    },
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

type Handler = (
  req: NextRequest,
  ctx?: { params: Promise<Record<string, string>> }
) => Promise<Response>;

const BASE = 'https://bugs.example.com/api/v1/public/bug-reports';
const HEADERS = { 'Content-Type': 'application/json', 'X-API-Key': 'test-public-key' };

const PAUSED: [string, Handler, string, string][] = [
  ['GET /me', me.GET as Handler, 'GET', `${BASE}/me?reporter_email=a%40b.com`],
  ['GET /stats', stats.GET as Handler, 'GET', `${BASE}/stats?reporter_email=a%40b.com`],
  ['GET /:id', byId.GET as Handler, 'GET', `${BASE}/${BUG_ID}?reporter_email=a%40b.com`],
  ['PATCH /:id', byId.PATCH as Handler, 'PATCH', `${BASE}/${BUG_ID}`],
  ['GET /:id/messages', messages.GET as Handler, 'GET', `${BASE}/${BUG_ID}/messages?reporter_email=a%40b.com`],
  ['POST /:id/messages', messages.POST as Handler, 'POST', `${BASE}/${BUG_ID}/messages`],
  ['POST /:id/status', status.POST as Handler, 'POST', `${BASE}/${BUG_ID}/status`],
];

beforeEach(() => {
  db.createClientCalls = 0;
});

describe.each(PAUSED)('%s', (_name, handler, method, url) => {
  it('answers 503 TEMPORARILY_DISABLED with CORS headers, before any database call', async () => {
    const req = new NextRequest(url, {
      method,
      headers: HEADERS,
      body: method === 'GET' ? undefined : JSON.stringify({ reporter_email: 'a@b.com', status: 'closed', message: 'x' }),
    });
    const res = await handler(req, { params: Promise.resolve({ id: BUG_ID }) });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'TEMPORARILY_DISABLED',
        message:
          'Viewing your reports here is paused for a security fix. Your bug reports are still being received.',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(db.createClientCalls).toBe(0);
  });
});

describe('submit (POST /api/v1/public/bug-reports)', () => {
  it('is not paused', async () => {
    const req = new NextRequest(BASE, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ title: 't', description: 'd', page_url: 'https://app.example.com/x' }),
    });
    const res = await (submit.POST as Handler)(req);
    expect(res.status).toBe(201);
    expect(db.createClientCalls).toBeGreaterThan(0);
  });
});
