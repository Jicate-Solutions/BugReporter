import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * AI task builder routes: who may create / draft / restore / switch / reassign,
 * how the task key is made, and that a draft never changes the live task.
 * The service client is an in-memory fake of the handful of tables involved.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: null as null | { id: string },
  tables: {} as Record<string, Row[]>,
  writes: [] as { table: string; op: 'insert' | 'update'; row: Row }[]
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) }
  })
}));

vi.mock('@/lib/supabase/admin', () => {
  const UNIQUE: Record<string, string[]> = {
    ai_tasks: ['job_type'],
    ai_task_versions: ['job_type', 'version']
  };
  class Q {
    private op: 'select' | 'insert' | 'update' = 'select';
    private filters: ((r: Row) => boolean)[] = [];
    private sort: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private payload: Row = {};
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) {
      this.sort = { col: c, asc: o?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    insert(row: Row) {
      this.op = 'insert';
      this.payload = row;
      return this;
    }
    update(row: Row) {
      this.op = 'update';
      this.payload = row;
      return this;
    }
    private rows() {
      return (db.tables[this.table] ??= []);
    }
    private run(): { data: Row[] | null; error: { code?: string; message: string } | null } {
      if (this.op === 'insert') {
        const keys = UNIQUE[this.table] ?? [];
        const clash =
          keys.length > 0 &&
          this.rows().some((r) => keys.every((k) => r[k] === this.payload[k]));
        if (clash) return { data: null, error: { code: '23505', message: 'duplicate' } };
        const row = {
          tested_ok_at: null,
          created_at: new Date().toISOString(),
          ...this.payload
        };
        this.rows().push(row);
        db.writes.push({ table: this.table, op: 'insert', row: this.payload });
        return { data: [row], error: null };
      }
      let hit = this.rows().filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        for (const r of hit) Object.assign(r, this.payload);
        db.writes.push({ table: this.table, op: 'update', row: this.payload });
        return { data: hit, error: null };
      }
      if (this.sort) {
        const { col, asc } = this.sort;
        hit = [...hit].sort((a, b) => ((a[col] as number) > (b[col] as number) ? 1 : -1) * (asc ? 1 : -1));
      }
      if (this.max != null) hit = hit.slice(0, this.max);
      return { data: hit, error: null };
    }
    async maybeSingle() {
      const r = this.run();
      return { data: r.data?.[0] ?? null, error: r.error };
    }
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(this.run()).then(res, rej);
    }
  }
  return { createAdminClient: () => ({ from: (t: string) => new Q(t) }) };
});

const tasksRoute = await import('@/app/api/internal/ai-engine/task-builder/tasks/route');
const versionsRoute = await import('@/app/api/internal/ai-engine/task-builder/versions/route');
const restoreRoute = await import('@/app/api/internal/ai-engine/task-builder/restore/route');
const switchRoute = await import('@/app/api/internal/ai-engine/task-builder/switch/route');
const ownerRoute = await import('@/app/api/internal/ai-engine/task-builder/owner/route');
const { deriveJobType } = await import('@/lib/ai-engine/task-builder');

const SUPER = 'u-super';
const DEV_A = 'u-dev-a'; // developer in organisation A
const APPDEV_B = 'u-appdev-b'; // developer on app B only
const VIEWER_A = 'u-viewer-a'; // viewer on app A only
const OUTSIDER = 'u-outsider';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const APP_A = '11111111-1111-4111-8111-111111111111';
const APP_B = '22222222-2222-4222-8222-222222222222';

const RECIPE = {
  title: 'Summarize feedback',
  description: 'Short summary of a feedback form.',
  instructions: 'Summarize the feedback in the DATA block in three bullet points.',
  model: 'haiku',
  output_format: 'text',
  required_inputs: ['feedback'],
  max_answer_words: 120,
  timeout_seconds: 60,
  queue_wait_seconds: 90
};

const LIVE_INSTRUCTIONS = 'Summarize the bug report for a busy developer, plain English.';

function seed() {
  db.writes.length = 0;
  db.tables = {
    super_admins: [{ user_id: SUPER }],
    organization_members: [{ user_id: DEV_A, organization_id: ORG_A, role: 'developer' }],
    application_members: [
      { user_id: APPDEV_B, application_id: APP_B, role: 'developer' },
      { user_id: VIEWER_A, application_id: APP_A, role: 'viewer' }
    ],
    applications: [
      { id: APP_A, name: 'Yi Creative', slug: 'yi-creative', organization_id: ORG_A },
      { id: APP_B, name: 'Poppys', slug: 'poppys', organization_id: ORG_B }
    ],
    profiles: [
      { id: DEV_A, email: 'dev.a@jkkn.ac.in' },
      { id: APPDEV_B, email: 'dev_b@jkkn.ac.in' }
    ],
    ai_runners: [{ name: 'jicate-1', last_seen_at: new Date().toISOString() }],
    ai_tasks: [
      {
        job_type: 'bug.summarize',
        title: 'Bug summary',
        description: 'Plain-English summary.',
        instructions: LIVE_INSTRUCTIONS,
        model: 'sonnet',
        effort: null,
        output_format: 'text',
        interactive: true,
        enabled: true,
        max_inflight: 2,
        max_payload_bytes: 32768,
        timeout_seconds: 120,
        max_answer_words: null,
        required_inputs: [],
        queue_wait_seconds: 120,
        created_by: null,
        owner_app: null
      },
      {
        job_type: 'yi_creative.caption',
        title: 'Caption',
        description: '',
        instructions: 'Write one caption for the photo described in DATA.',
        model: 'sonnet',
        effort: null,
        output_format: 'text',
        interactive: true,
        enabled: true,
        max_inflight: 2,
        max_payload_bytes: 32768,
        timeout_seconds: 120,
        max_answer_words: null,
        required_inputs: [],
        queue_wait_seconds: 120,
        created_by: DEV_A,
        owner_app: APP_A
      }
    ],
    ai_task_versions: []
  };
}

const BASE = 'https://tower.test/api/internal/ai-engine/task-builder';
const post = (path: string, body: unknown) =>
  new NextRequest(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
const as = (id: string | null) => {
  db.user = id ? { id } : null;
};
const task = (jobType: string) => db.tables.ai_tasks.find((t) => t.job_type === jobType)!;
const versions = (jobType: string) =>
  db.tables.ai_task_versions.filter((v) => v.job_type === jobType);

beforeEach(() => {
  seed();
  as(null);
});

describe('task key (job_type)', () => {
  it('prefixes the app slug, folds hyphens and spaces to underscores', () => {
    expect(deriveJobType('yi-creative', 'Summarize feedback')).toEqual({
      ok: true,
      jobType: 'yi_creative.summarize_feedback'
    });
    expect(deriveJobType('poppys', 'reply.draft v2')).toEqual({
      ok: true,
      jobType: 'poppys.reply_draft_v2'
    });
  });
  it('forces a leading letter on the slug and refuses a name without one', () => {
    expect(deriveJobType('3d-lab', 'render')).toEqual({ ok: true, jobType: 'app_3d_lab.render' });
    expect(deriveJobType('poppys', '42').ok).toBe(false);
    expect(deriveJobType('poppys', '!!').ok).toBe(false);
    expect(deriveJobType('---', 'render').ok).toBe(false);
  });
});

describe('create task', () => {
  it('refuses a caller who is not signed in', async () => {
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'x y', recipe: RECIPE }));
    expect(res.status).toBe(401);
  });

  it('refuses a non-member', async () => {
    as(OUTSIDER);
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Summarize feedback', recipe: RECIPE }));
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it('refuses a developer of app A creating for app B', async () => {
    as(DEV_A);
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_B, name: 'Summarize feedback', recipe: RECIPE }));
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it('refuses an app viewer', async () => {
    as(VIEWER_A);
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Summarize feedback', recipe: RECIPE }));
    expect(res.status).toBe(403);
  });

  it('creates an OFF task with the prefixed key, owner, owner app and version 1', async () => {
    as(DEV_A);
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Summarize feedback', recipe: RECIPE }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ job_type: 'yi_creative.summarize_feedback', version: 1 });
    const row = task('yi_creative.summarize_feedback');
    expect(row).toMatchObject({
      enabled: false,
      created_by: DEV_A,
      owner_app: APP_A,
      model: 'haiku',
      queue_wait_seconds: 90,
      required_inputs: ['feedback']
    });
    expect(versions('yi_creative.summarize_feedback')).toMatchObject([
      { version: 1, status: 'published', created_by: DEV_A }
    ]);
  });

  it('lets an app developer (no organisation role) create for that app', async () => {
    as(APPDEV_B);
    const res = await tasksRoute.POST(post('tasks', { app_id: APP_B, name: 'Reply draft', recipe: RECIPE }));
    expect(res.status).toBe(201);
    expect(task('poppys.reply_draft').owner_app).toBe(APP_B);
  });

  it('refuses a bad name and a name already taken', async () => {
    as(DEV_A);
    const bad = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: '12', recipe: RECIPE }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('BAD_NAME');
    const dup = await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Caption', recipe: RECIPE }));
    expect(dup.status).toBe(409);
  });

  it('refuses a recipe with an unknown field shape', async () => {
    as(DEV_A);
    const res = await tasksRoute.POST(
      post('tasks', { app_id: APP_A, name: 'ok name', recipe: { ...RECIPE, instructions: 'short' } })
    );
    expect(res.status).toBe(400);
  });
});

describe('drafts', () => {
  it('a draft is a new version and does not change the live task', async () => {
    as(DEV_A);
    const res = await versionsRoute.POST(
      post('versions', {
        job_type: 'bug.summarize',
        recipe: { ...RECIPE, title: 'Bug summary', instructions: 'Completely new wording for the bug summary task.' }
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 2 });
    // Version 1 keeps the live recipe from before any edit; version 2 is the draft.
    expect(versions('bug.summarize')).toMatchObject([
      { version: 1, status: 'published', recipe: { instructions: LIVE_INSTRUCTIONS } },
      { version: 2, status: 'draft', created_by: DEV_A }
    ]);
    expect(task('bug.summarize').instructions).toBe(LIVE_INSTRUCTIONS);
    expect(db.writes.filter((w) => w.table === 'ai_tasks')).toEqual([]);
  });

  it('refuses a non-member', async () => {
    as(OUTSIDER);
    const res = await versionsRoute.POST(post('versions', { job_type: 'bug.summarize', recipe: RECIPE }));
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it('lists versions for a developer, not for a non-member', async () => {
    as(DEV_A);
    await versionsRoute.POST(post('versions', { job_type: 'bug.summarize', recipe: RECIPE }));
    const ok = await versionsRoute.GET(new NextRequest(`${BASE}/versions?job_type=bug.summarize`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(body.versions[0].created_by_email).toBe('dev.a@jkkn.ac.in');
    as(OUTSIDER);
    const no = await versionsRoute.GET(new NextRequest(`${BASE}/versions?job_type=bug.summarize`));
    expect(no.status).toBe(403);
  });
});

describe('restore', () => {
  async function draftThenRestoreV1(user: string) {
    as(DEV_A);
    await versionsRoute.POST(
      post('versions', { job_type: 'bug.summarize', recipe: { ...RECIPE, instructions: 'A different recipe wording here.' } })
    );
    as(user);
    return restoreRoute.POST(post('restore', { job_type: 'bug.summarize', version: 1 }));
  }

  it('a developer restore becomes a new draft; the live task is unchanged', async () => {
    const res = await draftThenRestoreV1(DEV_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 3, applied: false });
    expect(versions('bug.summarize')[2]).toMatchObject({
      version: 3,
      status: 'draft',
      recipe: { instructions: LIVE_INSTRUCTIONS }
    });
    expect(db.writes.filter((w) => w.table === 'ai_tasks')).toEqual([]);
  });

  it('a super admin restore goes straight onto the live task', async () => {
    as(DEV_A);
    await versionsRoute.POST(
      post('versions', { job_type: 'bug.summarize', recipe: { ...RECIPE, instructions: 'A different recipe wording here.' } })
    );
    as(SUPER);
    const res = await restoreRoute.POST(post('restore', { job_type: 'bug.summarize', version: 2 }));
    expect(await res.json()).toEqual({ version: 3, applied: true });
    expect(task('bug.summarize').instructions).toBe('A different recipe wording here.');
    expect(task('bug.summarize').enabled).toBe(true);
    expect(versions('bug.summarize')[2]).toMatchObject({ status: 'restored', created_by: SUPER });
  });

  it('refuses a non-member', async () => {
    const res = await draftThenRestoreV1(OUTSIDER);
    expect(res.status).toBe(403);
  });
});

describe('on / off', () => {
  it('switching ON is refused until the latest version has passed a test', async () => {
    as(DEV_A);
    await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Summarize feedback', recipe: RECIPE }));
    const jt = 'yi_creative.summarize_feedback';
    const refused = await switchRoute.POST(post('switch', { job_type: jt, on: true }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe('NOT_TESTED');
    expect(task(jt).enabled).toBe(false);

    // Stand-in for the test runner (later PR): mark the latest version as passed.
    versions(jt)[0].tested_ok_at = new Date().toISOString();
    const ok = await switchRoute.POST(post('switch', { job_type: jt, on: true }));
    expect(ok.status).toBe(200);
    expect(task(jt).enabled).toBe(true);
  });

  it('switching ON is refused while no worker is alive, even after a test', async () => {
    as(DEV_A);
    await tasksRoute.POST(post('tasks', { app_id: APP_A, name: 'Summarize feedback', recipe: RECIPE }));
    const jt = 'yi_creative.summarize_feedback';
    versions(jt)[0].tested_ok_at = new Date().toISOString();
    db.tables.ai_runners = [{ name: 'jicate-1', last_seen_at: '2026-01-01T00:00:00.000Z' }];
    const res = await switchRoute.POST(post('switch', { job_type: jt, on: true }));
    expect((await res.json()).error.code).toBe('NO_WORKER');
    expect(task(jt).enabled).toBe(false);
  });

  it('switching OFF is immediate for a developer, no test needed', async () => {
    as(APPDEV_B);
    const res = await switchRoute.POST(post('switch', { job_type: 'bug.summarize', on: false }));
    expect(res.status).toBe(200);
    expect(task('bug.summarize').enabled).toBe(false);
  });

  it('an app viewer can switch its own app\'s task off but not on', async () => {
    as(VIEWER_A);
    const off = await switchRoute.POST(post('switch', { job_type: 'yi_creative.caption', on: false }));
    expect(off.status).toBe(200);
    expect(task('yi_creative.caption').enabled).toBe(false);
    const on = await switchRoute.POST(post('switch', { job_type: 'yi_creative.caption', on: true }));
    expect(on.status).toBe(403);
    expect(task('yi_creative.caption').enabled).toBe(false);
  });

  it('a non-member cannot switch anything', async () => {
    as(OUTSIDER);
    const res = await switchRoute.POST(post('switch', { job_type: 'bug.summarize', on: false }));
    expect(res.status).toBe(403);
    expect(task('bug.summarize').enabled).toBe(true);
  });
});

describe('reassign owner', () => {
  it('is for super admins only', async () => {
    as(DEV_A);
    const res = await ownerRoute.POST(post('owner', { job_type: 'yi_creative.caption', owner_email: 'dev_b@jkkn.ac.in' }));
    expect(res.status).toBe(403);
    expect(task('yi_creative.caption').created_by).toBe(DEV_A);
  });

  it('a super admin hands the task to another person by email', async () => {
    as(SUPER);
    const res = await ownerRoute.POST(post('owner', { job_type: 'yi_creative.caption', owner_email: 'Dev_B@jkkn.ac.in' }));
    expect(res.status).toBe(200);
    expect(task('yi_creative.caption').created_by).toBe(APPDEV_B);
    expect(task('yi_creative.caption').enabled).toBe(true);
  });

  it('says so when no account uses that email', async () => {
    as(SUPER);
    const res = await ownerRoute.POST(post('owner', { job_type: 'yi_creative.caption', owner_email: 'nobody@jkkn.ac.in' }));
    expect(res.status).toBe(404);
  });
});
