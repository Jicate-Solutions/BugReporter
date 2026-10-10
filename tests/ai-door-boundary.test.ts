import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeDb } from './helpers/fake-supabase';

const h = vi.hoisted(() => ({ db: null as unknown as import('./helpers/fake-supabase').FakeDb }));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.db.client() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.db.client() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.db.client() }));

import { POST as doorPOST, GET as doorGET } from '@/app/api/v1/public/ai/run/route';
import { POST as internalAiPOST } from '@/app/api/internal/ai/route';
import { POST as runNowPOST } from '@/app/api/internal/routines/run/route';
import { runDispatcher } from '@/lib/routines/dispatcher';

const ORG = '30000000-0000-0000-0000-000000000001';
const CLIENT_APP = '00000000-0000-0000-0000-00000000000a';
const JICATE_APP = '00000000-0000-0000-0000-00000000000c';
const CLIENT_BUG = '10000000-0000-0000-0000-000000000001';
const JICATE_BUG = '10000000-0000-0000-0000-000000000002';
const ROUTINE_CLIENT = '40000000-0000-0000-0000-000000000001';

const org = { id: ORG, name: 'JICATE', slug: 'jicate' };
const aiOn = { ai: { enabled: true, allowed_tasks: ['bug.summarize', 'bug.suggest_fix'] } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.db = new FakeDb({
    organizations: [org],
    super_admins: [{ user_id: 'u1' }],
    applications: [
      // Quotation Office today: AI switched on, about to be marked client.
      { id: CLIENT_APP, name: 'Quotation Office', slug: 'quotation-office', organization_id: ORG, api_key: 'client-app-key', data_boundary: 'client', settings: aiOn, organizations: org },
      { id: JICATE_APP, name: 'JKKN Tool', slug: 'jkkn-tool', organization_id: ORG, api_key: 'jicate-app-key', data_boundary: 'jicate', settings: aiOn, organizations: org }
    ],
    bug_reports: [
      { id: CLIENT_BUG, organization_id: ORG, application_id: CLIENT_APP, display_id: 'BUG-1', description: 'CLIENT SECRET TEXT', page_url: 'https://c', metadata: { title: 'client bug' }, status: 'new', category: 'bug', created_at: '2026-10-01T00:00:00Z' },
      { id: '10000000-0000-0000-0000-000000000003', organization_id: ORG, application_id: CLIENT_APP, display_id: 'BUG-3', description: 'more client text', status: 'new', category: 'security', created_at: '2026-10-02T00:00:00Z' },
      { id: JICATE_BUG, organization_id: ORG, application_id: JICATE_APP, display_id: 'BUG-2', description: 'jicate bug', page_url: 'https://j', metadata: { title: 'jicate bug' }, status: 'new', category: 'bug', created_at: '2026-10-03T00:00:00Z' }
    ],
    app_ai_routines: [],
    app_ai_routine_runs: []
  });
  h.db.user = { id: 'u1' };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role';
  process.env.MYJKKN_AI_URL = 'https://myjkkn.example';
  process.env.MYJKKN_AI_KEY = 'fake-engine-key';
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MYJKKN_AI_URL;
  delete process.env.MYJKKN_AI_KEY;
});

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

describe('public AI Door (/api/v1/public/ai/run)', () => {
  it('refuses a client app even with AI switched on and the task approved, and never calls MyJKKN', async () => {
    const res = await doorPOST(json('/api/v1/public/ai/run', { task: 'bug.suggest_fix', payload: { text: 'x' } }, { 'x-api-key': 'client-app-key' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('client_data_boundary');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses polling for a client app too', async () => {
    const res = await doorGET(
      new NextRequest('http://localhost/api/v1/public/ai/run?job_id=50000000-0000-0000-0000-000000000001', {
        headers: { 'x-api-key': 'client-app-key' }
      })
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when the boundary cannot be read (fails closed)', async () => {
    h.db.rows('applications')[1].data_boundary = undefined;
    const res = await doorPOST(json('/api/v1/public/ai/run', { task: 'bug.summarize' }, { 'x-api-key': 'jicate-app-key' }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still forwards for a jicate app', async () => {
    const res = await doorPOST(json('/api/v1/public/ai/run', { task: 'bug.summarize' }, { 'x-api-key': 'jicate-app-key' }));
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('dashboard AI route (/api/internal/ai)', () => {
  it('triage on a client bug is refused before any bug text is sent', async () => {
    const res = (await internalAiPOST(json('/api/internal/ai', { kind: 'triage', organizationId: ORG, bugId: CLIENT_BUG, task: 'bug.summarize' })))!;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('triage on a jicate bug still works', async () => {
    const res = (await internalAiPOST(json('/api/internal/ai', { kind: 'triage', organizationId: ORG, bugId: JICATE_BUG, task: 'bug.summarize' })))!;
    expect(res.status).toBe(202);
  });

  it('an app-scoped brief for a client app is refused', async () => {
    const res = (await internalAiPOST(json('/api/internal/ai', { kind: 'brief', organizationId: ORG, applicationId: CLIENT_APP })))!;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the org-wide brief leaves client apps out of the numbers and names', async () => {
    const res = (await internalAiPOST(json('/api/internal/ai', { kind: 'brief', organizationId: ORG })))!;
    expect(res.status).toBe(202);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sent = JSON.parse(String(init.body));
    expect(sent.payload.stats).toContain('Total bugs across 1 reporting apps: 1.');
    expect(sent.payload.stats).not.toContain('Quotation Office');
    expect(sent.payload.stats).toContain('Open security bugs: 0.');
  });
});

describe('routines', () => {
  it('run-now refuses a routine scoped to a client app', async () => {
    h.db.rows('app_ai_routines').push({ id: ROUTINE_CLIENT, organization_id: ORG, application_id: CLIENT_APP, routine_kind: 'app.brief' });
    const res = await runNowPOST(json('/api/internal/routines/run', { routineId: ROUTINE_CLIENT }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the dispatcher records an error run for a client-app routine and never calls MyJKKN', async () => {
    h.db.rpcs.fn_app_routine_prune = () => 0;
    h.db.rpcs.fn_app_routine_record_fire = () => null;
    h.db.rpcs.fn_app_routine_claim_due = () => [
      { id: ROUTINE_CLIENT, organization_id: ORG, application_id: CLIENT_APP, routine_kind: 'app.brief' }
    ];
    const summary = await runDispatcher(h.db.client());
    expect(summary.failed).toBe(1);
    expect(summary.enqueued).toBe(0);
    const runs = h.db.rows('app_ai_routine_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('error');
    expect(runs[0].error).toContain('client app');
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });
});
