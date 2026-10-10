import { describe, it, expect } from 'vitest';
import { FakeDb } from './helpers/fake-supabase';
import { enqueueTriageForBug, backfillTriageJobs, isTriageEligible } from '@/lib/triage/enqueue';

const apps = [
  { id: 'client-on', data_boundary: 'client', settings: { triage: { enabled: true } } },
  { id: 'client-off', data_boundary: 'client', settings: { triage: { enabled: false } } },
  { id: 'client-none', data_boundary: 'client', settings: {} },
  { id: 'client-string', data_boundary: 'client', settings: { triage: { enabled: 'true' } } },
  { id: 'jicate-on', data_boundary: 'jicate', settings: { triage: { enabled: true } } },
  { id: 'jicate-off', data_boundary: 'jicate', settings: { triage: { enabled: false } } },
  { id: 'jicate-none', data_boundary: 'jicate', settings: null },
  { id: 'legacy-on', settings: { triage: { enabled: true } } } // column missing / pre-migration
];

describe('isTriageEligible', () => {
  it('is true for any app with triage literally switched on, whatever its boundary', () => {
    expect(apps.filter((a) => isTriageEligible(a)).map((a) => a.id)).toEqual(['client-on', 'jicate-on', 'legacy-on']);
    expect(isTriageEligible(null)).toBe(false);
  });
});

describe('enqueueTriageForBug (intake producer)', () => {
  it('queues one job for every triage-enabled app (client or jicate) and none when triage is off', async () => {
    const db = new FakeDb({ applications: apps, triage_jobs: [] });
    const supabase = db.client();
    for (const app of apps) {
      const queued = await enqueueTriageForBug(supabase, { bugReportId: `bug-${app.id}`, applicationId: app.id });
      expect(queued).toBe(['client-on', 'jicate-on', 'legacy-on'].includes(app.id));
    }
    const jobs = db.rows('triage_jobs');
    expect(jobs.map((j) => j.application_id)).toEqual(['client-on', 'jicate-on', 'legacy-on']);
    expect(jobs.find((j) => j.application_id === 'jicate-on')).toMatchObject({
      bug_report_id: 'bug-jicate-on',
      kind: 'triage.v1',
      status: 'queued'
    });
  });

  it('dedupes per bug', async () => {
    const db = new FakeDb({ applications: apps, triage_jobs: [] });
    await enqueueTriageForBug(db.client(), { bugReportId: 'b1', applicationId: 'client-on' });
    await enqueueTriageForBug(db.client(), { bugReportId: 'b1', applicationId: 'client-on' });
    expect(db.rows('triage_jobs')).toHaveLength(1);
  });

  it('never throws and never queues when the app cannot be read', async () => {
    const db = new FakeDb({ applications: apps, triage_jobs: [] });
    db.failNext('applications', 'select');
    await expect(enqueueTriageForBug(db.client(), { bugReportId: 'b1', applicationId: 'client-on' })).resolves.toBe(false);
    db.failNext('triage_jobs', 'upsert');
    await expect(enqueueTriageForBug(db.client(), { bugReportId: 'b2', applicationId: 'client-on' })).resolves.toBe(false);
    expect(db.rows('triage_jobs')).toHaveLength(0);
  });
});

describe('backfillTriageJobs', () => {
  const bugs = [
    { id: 'b1', application_id: 'client-on', status: 'new', created_at: '2026-01-01' },
    { id: 'b2', application_id: 'client-on', status: 'resolved', created_at: '2026-01-02' },
    { id: 'b3', application_id: 'client-on', status: 'in_progress', created_at: '2026-01-03' },
    { id: 'b4', application_id: 'client-on', status: 'closed', created_at: '2026-01-04' },
    { id: 'b5', application_id: 'client-on', status: 'seen', created_at: '2026-01-05' },
    { id: 'b6', application_id: 'client-on', status: 'wont_fix', created_at: '2026-01-06' },
    { id: 'j1', application_id: 'jicate-on', status: 'new', created_at: '2026-01-01' },
    { id: 'j2', application_id: 'jicate-on', status: 'resolved', created_at: '2026-01-02' },
    { id: 'k1', application_id: 'jicate-off', status: 'new', created_at: '2026-01-01' }
  ];

  it('queues open bugs only, oldest first, in small batches, skipping ones already queued', async () => {
    const db = new FakeDb({
      applications: apps,
      bug_reports: bugs,
      triage_jobs: [{ id: 'x', bug_report_id: 'b3', application_id: 'client-on', kind: 'triage.v1', status: 'done' }]
    });
    const first = await backfillTriageJobs(db.client(), 'client-on', 1);
    expect(first).toMatchObject({ eligible: true, enqueued: 1 });
    const second = await backfillTriageJobs(db.client(), 'client-on', 25);
    expect(second.enqueued).toBe(1);
    const third = await backfillTriageJobs(db.client(), 'client-on', 25);
    expect(third.enqueued).toBe(0);
    expect(db.rows('triage_jobs').map((j) => j.bug_report_id).sort()).toEqual(['b1', 'b3', 'b5']);
  });

  it('works for a jicate app with triage on', async () => {
    const db = new FakeDb({ applications: apps, bug_reports: bugs, triage_jobs: [] });
    expect(await backfillTriageJobs(db.client(), 'jicate-on', 25)).toMatchObject({ eligible: true, enqueued: 1 });
    expect(db.rows('triage_jobs').map((j) => j.bug_report_id)).toEqual(['j1']);
  });

  it('refuses apps with triage off, whatever their boundary', async () => {
    const db = new FakeDb({ applications: apps, bug_reports: bugs, triage_jobs: [] });
    for (const id of ['jicate-off', 'jicate-none', 'client-off', 'client-none', 'client-string']) {
      expect(await backfillTriageJobs(db.client(), id, 25)).toEqual({ eligible: false, scanned: 0, enqueued: 0 });
    }
    expect(db.rows('triage_jobs')).toHaveLength(0);
  });
});
