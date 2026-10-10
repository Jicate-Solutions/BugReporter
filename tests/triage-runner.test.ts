import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeDb } from './helpers/fake-supabase';

const h = vi.hoisted(() => ({ db: null as unknown as import('./helpers/fake-supabase').FakeDb }));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.db.client() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.db.client() }));

import { POST as claimPOST } from '@/app/api/internal/triage/claim/route';
import { POST as completePOST } from '@/app/api/internal/triage/complete/route';
import { GET as cronGET } from '@/app/api/cron/app-routine-dispatcher/route';
import { POST as aiRunPOST } from '@/app/api/v1/public/ai/run/route';

const TOKEN = 't'.repeat(48);
const APP_KEY = 'app-key-for-tests-only';
const APP = '00000000-0000-0000-0000-00000000000a';
const OTHER_APP = '00000000-0000-0000-0000-00000000000b';
const BUG = '10000000-0000-0000-0000-000000000001';
const JOB = '20000000-0000-0000-0000-000000000001';

function req(path: string, opts: { auth?: string; apiKey?: string; body?: unknown; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
  return new NextRequest(`http://localhost${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? {})
  });
}

function seed(jobOverrides: Record<string, unknown> = {}) {
  h.db = new FakeDb({
    applications: [
      {
        id: APP,
        name: 'Elevar ERP',
        slug: 'elevar-erp',
        organization_id: 'org1',
        api_key: APP_KEY,
        data_boundary: 'client',
        settings: { triage: { enabled: true }, ai: { enabled: true, allowed_tasks: ['bug.summarize'] } },
        organizations: { id: 'org1', name: 'Org', slug: 'org' }
      },
      { id: OTHER_APP, name: 'Other', slug: 'other', organization_id: 'org1', data_boundary: 'client', settings: {} }
    ],
    bug_reports: [
      {
        id: BUG,
        display_id: 'BUG-101',
        application_id: APP,
        organization_id: 'org1',
        status: 'new',
        description: 'Invoice total is wrong after adding GST',
        page_url: 'https://erp.example.com/invoices/42?session=secret-token#tab',
        category: 'bug',
        console_logs: [
          { level: 'log', message: 'boot', timestamp: 't' },
          { level: 'error', message: 'TypeError: cannot read total', timestamp: 't' }
        ],
        metadata: {
          title: 'Wrong invoice total',
          reporter_name: 'Priya',
          reporter_email: 'priya@client.example',
          network_trace: [{ url: 'https://erp.example.com/api?key=abc' }]
        },
        reporter_email: 'priya@client.example',
        screenshot_url: 'https://storage.example/shot.png'
      }
    ],
    triage_jobs: [
      {
        id: JOB,
        bug_report_id: BUG,
        application_id: APP,
        kind: 'triage.v1',
        status: 'claimed',
        attempts: 1,
        claimed_by: 'windows-triage',
        created_at: '2026-10-10T00:00:00.000Z',
        ...jobOverrides
      }
    ],
    bug_report_messages: []
  });
}

const verdict = {
  type: 'bug',
  severity: 'high',
  summary: 'Invoice total ignores GST\nline items',
  likely_area: 'Invoices',
  confidence: 0.8
};

beforeEach(() => {
  seed();
  process.env.TRIAGE_RUNNER_TOKEN = TOKEN;
  process.env.CRON_SECRET = 'c'.repeat(40);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role';
});
afterEach(() => {
  delete process.env.TRIAGE_RUNNER_TOKEN;
  delete process.env.CRON_SECRET;
  delete process.env.MYJKKN_AI_URL;
  delete process.env.MYJKKN_AI_KEY;
  vi.unstubAllGlobals();
});

describe('runner auth (claim + complete)', () => {
  for (const [name, handler, path] of [
    ['claim', claimPOST, '/api/internal/triage/claim'],
    ['complete', completePOST, '/api/internal/triage/complete']
  ] as const) {
    it(`${name}: 503 when TRIAGE_RUNNER_TOKEN is not set (never open)`, async () => {
      delete process.env.TRIAGE_RUNNER_TOKEN;
      const res = await handler(req(path, { auth: `Bearer ${TOKEN}` }));
      expect(res.status).toBe(503);
    });

    it(`${name}: 503 when the token is a copy of CRON_SECRET`, async () => {
      process.env.TRIAGE_RUNNER_TOKEN = process.env.CRON_SECRET;
      const res = await handler(req(path, { auth: `Bearer ${process.env.CRON_SECRET}` }));
      expect(res.status).toBe(503);
    });

    it(`${name}: 401 with no token`, async () => {
      const res = await handler(req(path));
      expect(res.status).toBe(401);
    });

    it(`${name}: 401 with a wrong token`, async () => {
      const res = await handler(req(path, { auth: `Bearer ${'x'.repeat(48)}` }));
      expect(res.status).toBe(401);
    });

    it(`${name}: 401 with an app API key (header or bearer), even next to the right token`, async () => {
      expect((await handler(req(path, { apiKey: APP_KEY }))).status).toBe(401);
      expect((await handler(req(path, { auth: `Bearer ${APP_KEY}` }))).status).toBe(401);
      const both = await handler(req(path, { auth: `Bearer ${TOKEN}`, apiKey: APP_KEY }));
      expect(both.status).toBe(401);
      expect((await both.json()).error.code).toBe('APP_KEY_NOT_ACCEPTED');
    });
  }

  it('the runner token does not open other routes', async () => {
    const cron = await cronGET(req('/api/cron/app-routine-dispatcher', { auth: `Bearer ${TOKEN}`, method: 'GET' }));
    expect(cron.status).toBe(401);
    const door = await aiRunPOST(req('/api/v1/public/ai/run', { auth: `Bearer ${TOKEN}`, body: { task: 'bug.summarize' } }));
    expect(door.status).toBe(401);
  });
});

describe('claim', () => {
  it('returns one job with only the minimal fields', async () => {
    seed({ status: 'queued', attempts: 0, claimed_by: null });
    h.db.rpcs.fn_triage_claim = (args: { p_runner: string }) => {
      const job = h.db.rows('triage_jobs').find((j) => j.status === 'queued');
      if (!job) return [];
      Object.assign(job, { status: 'claimed', claimed_by: args.p_runner, attempts: job.attempts + 1 });
      return [{ ...job }];
    };
    h.db.rpcs.find_similar_bugs = () => [
      { display_id: 'BUG-90', title: 'GST missing', description: 'Total excludes GST', status: 'new', application_id: APP },
      { display_id: 'BUG-91', title: 'Other app bug', description: 'not ours', status: 'new', application_id: OTHER_APP }
    ];

    const res = await claimPOST(req('/api/internal/triage/claim', { auth: `Bearer ${TOKEN}`, body: { runner: 'windows-triage' } }));
    expect(res.status).toBe(200);
    const { job } = await res.json();
    expect(job.job_id).toBe(JOB);
    expect(job.app_name).toBe('Elevar ERP');
    expect(job.bug.display_id).toBe('BUG-101');
    expect(job.bug.page_url).toBe('https://erp.example.com/invoices/42');
    expect(job.bug.console_excerpt).toBe('error: TypeError: cannot read total');
    expect(job.similar.map((s: { display_id: string }) => s.display_id)).toEqual(['BUG-90']);

    const text = JSON.stringify(job);
    for (const leak of ['priya', 'Priya', 'shot.png', 'network_trace', 'secret-token', 'key=abc']) {
      expect(text).not.toContain(leak);
    }
    expect(h.db.rows('triage_jobs')[0].claimed_by).toBe('windows-triage');
  });

  it('returns { job: null } when nothing is queued', async () => {
    h.db.rpcs.fn_triage_claim = () => [];
    const res = await claimPOST(req('/api/internal/triage/claim', { auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job: null });
  });
});

describe('complete', () => {
  const call = (body: unknown) =>
    completePOST(req('/api/internal/triage/complete', { auth: `Bearer ${TOKEN}`, body }));

  it('writes one internal AI note, reads it back, marks the job done, leaves bug status alone', async () => {
    const res = await call({ job_id: JOB, verdict });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('done');

    const msgs = h.db.rows('bug_report_messages');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      bug_report_id: BUG,
      author_kind: 'ai',
      author_email: null,
      sender_user_id: null,
      is_internal: true,
      message_type: 'system'
    });
    expect(msgs[0].message_text).toContain('AI triage');
    expect(msgs[0].message_text).toContain('Summary: Invoice total ignores GST line items');
    expect(body.message_id).toBe(msgs[0].id);

    // read-back happened before the job was marked done
    const ops = h.db.calls.map((c) => `${c.table}:${c.op}`);
    const insertAt = ops.indexOf('bug_report_messages:insert');
    const readAt = ops.indexOf('bug_report_messages:select', insertAt);
    const doneAt = ops.lastIndexOf('triage_jobs:update');
    expect(insertAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(insertAt);
    expect(doneAt).toBeGreaterThan(readAt);

    const job = h.db.rows('triage_jobs')[0];
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ type: 'bug', severity: 'high', message_id: msgs[0].id });
    expect(JSON.stringify(job.result)).not.toContain('Invoice total is wrong'); // no bug text
    expect(h.db.rows('bug_reports')[0].status).toBe('new');
    expect(h.db.calls.some((c) => c.table === 'bug_reports' && c.op === 'update')).toBe(false);
  });

  it('a failed note write leaves the job retryable (queued) and returns 502', async () => {
    h.db.failNext('bug_report_messages', 'insert', 'db down');
    const res = await call({ job_id: JOB, verdict });
    expect(res.status).toBe(502);
    const job = h.db.rows('triage_jobs')[0];
    expect(job.status).toBe('queued');
    expect(job.claimed_by).toBeNull();
    expect(job.error).toContain('db down');
    expect(h.db.rows('bug_report_messages')).toHaveLength(0);
  });

  it('a failed read-back also leaves the job retryable', async () => {
    // 1st select = dedupe lookup (must succeed), 2nd = read-back (fails)
    const db = h.db;
    const orig = db.takeFailure.bind(db);
    let selects = 0;
    db.takeFailure = (table, op) => {
      if (table === 'bug_report_messages' && op === 'select' && ++selects === 2) return 'read failed';
      return orig(table, op);
    };
    const res = await call({ job_id: JOB, verdict });
    expect(res.status).toBe(502);
    expect(h.db.rows('triage_jobs')[0].status).toBe('queued');
  });

  it('a retry after a half-finished attempt reuses the note instead of posting twice', async () => {
    h.db.rows('bug_report_messages').push({
      id: 'm-prior',
      bug_report_id: BUG,
      author_kind: 'ai',
      created_at: '2026-10-10T00:05:00.000Z'
    });
    const res = await call({ job_id: JOB, verdict });
    expect(res.status).toBe(200);
    expect(h.db.rows('bug_report_messages')).toHaveLength(1);
    expect((await res.json()).message_id).toBe('m-prior');
  });

  it('a give-up from the runner re-queues, and fails the job on its last attempt', async () => {
    let res = await call({ job_id: JOB, error: 'model returned prose' });
    expect((await res.json()).status).toBe('queued');
    expect(h.db.rows('triage_jobs')[0].status).toBe('queued');

    seed({ attempts: 3 });
    res = await call({ job_id: JOB, error: 'model returned prose' });
    expect((await res.json()).status).toBe('failed');
    expect(h.db.rows('triage_jobs')[0].status).toBe('failed');
  });

  it('refuses a job that is not claimed, and a malformed verdict', async () => {
    seed({ status: 'done' });
    expect((await call({ job_id: JOB, verdict })).status).toBe(409);
    seed();
    expect((await call({ job_id: JOB, verdict: { ...verdict, severity: 'urgent' } })).status).toBe(400);
    expect((await call({ job_id: 'not-a-uuid', verdict })).status).toBe(400);
    expect(h.db.rows('bug_report_messages')).toHaveLength(0);
  });
});
