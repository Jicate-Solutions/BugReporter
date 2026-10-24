/**
 * AI task builder — server side (Director, 2026-10-24).
 *
 * Developers create AI tasks for the apps they belong to and draft edits to any
 * existing task. Rules this module enforces (every route calls these, so the
 * checks run on the server whatever the page shows):
 *
 *   - A developer is a member of any organisation (owner / admin / developer),
 *     or a maintainer / developer of any app. Super admins count too.
 *   - Create: only for an app whose organisation the user belongs to, or that
 *     the user is a maintainer / developer of. New tasks start switched OFF.
 *   - Edit (any task, "shared tasks"): saved as a DRAFT version. A draft never
 *     touches the live ai_tasks row. It goes live only after a passing test run
 *     (the test runner is a later PR — see the HOOK after saveDraft).
 *   - Restore an earlier version: a new draft, same path. Super admins restore
 *     straight onto the live row.
 *   - OFF: anyone who can see the task, immediately. ON: only once the latest
 *     version has passed a test (tested_ok_at), and only while a worker is alive.
 *   - Owner: created_by. A task keeps running if its owner leaves; super admins
 *     can hand it to someone else.
 *
 * Every function takes the service-role client. Results are plain objects the
 * routes turn into JSON; nothing here throws for an expected refusal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isSuperAdmin, readRunners, runnerAlive } from '@/lib/ai-engine/admin';

// ── recipe ───────────────────────────────────────────────────────────────────

/** Same rule as the ai_tasks CHECK constraint: one dot, letters/digits/_ only. */
import { deriveJobType } from '@/lib/ai-engine/task-key';
export { JOB_TYPE_RE, TASK_MODELS, deriveJobType } from '@/lib/ai-engine/task-key';
export const TASK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

export const recipeSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  instructions: z.string().trim().min(20).max(20000),
  // The page offers the four models; any name the ai_tasks CHECK accepts is
  // allowed so an older recipe can still be restored.
  model: z.string().regex(/^[a-z0-9.-]{2,40}$/),
  effort: z.enum(TASK_EFFORTS).nullable().default(null),
  output_format: z.enum(['text', 'json']).default('text'),
  interactive: z.boolean().default(true),
  max_inflight: z.number().int().min(1).max(20).default(2),
  max_payload_bytes: z.number().int().min(256).max(262144).default(32768),
  timeout_seconds: z.number().int().min(10).max(600).default(120),
  max_answer_words: z.number().int().min(10).max(5000).nullable().default(null),
  required_inputs: z.array(z.string().regex(INPUT_NAME_RE)).max(20).default([]),
  queue_wait_seconds: z.number().int().min(5).max(3600).default(120)
});
export type Recipe = z.infer<typeof recipeSchema>;
export const RECIPE_FIELDS = Object.keys(recipeSchema.shape) as (keyof Recipe)[];

/** The recipe part of a live ai_tasks row (fields the builder versions). */
export function recipeOf(row: Record<string, unknown>): Recipe {
  const out: Record<string, unknown> = {};
  for (const f of RECIPE_FIELDS) out[f] = row[f];
  if (out.queue_wait_seconds == null) out.queue_wait_seconds = 120;
  if (out.required_inputs == null) out.required_inputs = [];
  if (out.effort === undefined) out.effort = null;
  if (out.max_answer_words === undefined) out.max_answer_words = null;
  return out as Recipe;
}

// ── who may do what ──────────────────────────────────────────────────────────

const BUILDER_ORG_ROLES = new Set(['owner', 'admin', 'developer']);
const BUILDER_APP_ROLES = new Set(['maintainer', 'developer']);

export interface Actor {
  userId: string;
  superAdmin: boolean;
  /** organization_id → role */
  orgRoles: Map<string, string>;
  /** application_id → role (viewer included; it is not a builder role) */
  appRoles: Map<string, string>;
}

export async function loadActor(admin: SupabaseClient, userId: string): Promise<Actor> {
  const [superAdmin, orgs, apps] = await Promise.all([
    isSuperAdmin(admin, userId),
    admin.from('organization_members').select('organization_id, role').eq('user_id', userId),
    admin.from('application_members').select('application_id, role').eq('user_id', userId)
  ]);
  return {
    userId,
    superAdmin,
    orgRoles: new Map(
      ((orgs.data ?? []) as { organization_id: string; role: string }[]).map((r) => [
        r.organization_id,
        r.role
      ])
    ),
    appRoles: new Map(
      ((apps.data ?? []) as { application_id: string; role: string }[]).map((r) => [
        r.application_id,
        r.role
      ])
    )
  };
}

/** A developer anywhere: may draft edits to any task and switch any task off. */
export function isBuilder(a: Actor): boolean {
  if (a.superAdmin) return true;
  for (const r of a.orgRoles.values()) if (BUILDER_ORG_ROLES.has(r)) return true;
  for (const r of a.appRoles.values()) if (BUILDER_APP_ROLES.has(r)) return true;
  return false;
}

export function canCreateFor(a: Actor, app: { id: string; organization_id: string }): boolean {
  return (
    a.superAdmin ||
    BUILDER_ORG_ROLES.has(a.orgRoles.get(app.organization_id) ?? '') ||
    BUILDER_APP_ROLES.has(a.appRoles.get(app.id) ?? '')
  );
}

/**
 * Who can see a task (and so may read its full instructions and versions, and
 * switch it off): any developer in ANY organisation, or anyone on its app.
 *
 * WARNING (single-org assumption). This is safe today only because the
 * platform has one organisation ("Jicate Solution"). When a second client
 * organisation joins, "any developer anywhere" becomes a cross-client leak:
 * that client's developers could read every other client's recipe text and
 * switch their tasks off. Before onboarding a second org, scope this to the
 * task's own organisation / owner app (shared tasks: decide explicitly), and
 * scope the isBuilder-based edit rights the same way. The database read rule
 * (fn_ai_task_visible in 20261024_ai_task_builder.sql) is already scoped to
 * the owner app.
 */
export function canSeeTask(a: Actor, task: { owner_app: string | null }): boolean {
  return isBuilder(a) || (task.owner_app != null && a.appRoles.has(task.owner_app));
}

export interface BuildableApp {
  id: string;
  name: string;
  slug: string;
  organization_id: string;
}

/** Apps this user may create tasks for (the "app it belongs to" list). */
export async function buildableApps(admin: SupabaseClient, a: Actor): Promise<BuildableApp[]> {
  const cols = 'id, name, slug, organization_id';
  let rows: BuildableApp[] = [];
  if (a.superAdmin) {
    const { data } = await admin.from('applications').select(cols).order('name');
    rows = (data ?? []) as BuildableApp[];
  } else {
    const orgIds = [...a.orgRoles].filter(([, r]) => BUILDER_ORG_ROLES.has(r)).map(([id]) => id);
    const appIds = [...a.appRoles].filter(([, r]) => BUILDER_APP_ROLES.has(r)).map(([id]) => id);
    const [byOrg, byApp] = await Promise.all([
      orgIds.length
        ? admin.from('applications').select(cols).in('organization_id', orgIds)
        : Promise.resolve({ data: [] }),
      appIds.length
        ? admin.from('applications').select(cols).in('id', appIds)
        : Promise.resolve({ data: [] })
    ]);
    const seen = new Map<string, BuildableApp>();
    for (const r of [...(byOrg.data ?? []), ...(byApp.data ?? [])] as BuildableApp[]) {
      seen.set(r.id, r);
    }
    rows = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }
  return rows.filter((app) => canCreateFor(a, app));
}

// ── results ──────────────────────────────────────────────────────────────────

export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const refuse = (status: number, code: string, message: string) =>
  ({ ok: false, status, code, message }) as const;

const NOT_A_DEVELOPER = refuse(
  403,
  'FORBIDDEN',
  'Only developers of an app on this platform can change AI tasks.'
);

// ── versions ─────────────────────────────────────────────────────────────────

export interface VersionRow {
  id: string;
  job_type: string;
  version: number;
  recipe: Recipe;
  status: 'draft' | 'published' | 'restored';
  created_by: string | null;
  created_at: string;
  tested_ok_at: string | null;
}

async function loadTask(admin: SupabaseClient, jobType: string) {
  const { data, error } = await admin
    .from('ai_tasks')
    .select('*')
    .eq('job_type', jobType)
    .maybeSingle();
  if (error) return null;
  return (data as Record<string, unknown> & { owner_app: string | null; enabled: boolean }) ?? null;
}

async function latestVersion(admin: SupabaseClient, jobType: string): Promise<VersionRow | null> {
  const { data } = await admin
    .from('ai_task_versions')
    .select('*')
    .eq('job_type', jobType)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as VersionRow | null) ?? null;
}

async function insertVersion(
  admin: SupabaseClient,
  jobType: string,
  recipe: Recipe,
  status: VersionRow['status'],
  userId: string | null
): Promise<number | null> {
  // Two saves at the same moment can pick the same number; UNIQUE(job_type,
  // version) refuses the second, which then takes the next one.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = ((await latestVersion(admin, jobType))?.version ?? 0) + 1;
    const { error } = await admin.from('ai_task_versions').insert({
      job_type: jobType,
      version: next,
      recipe,
      status,
      created_by: userId
    });
    if (!error) return next;
    if ((error as { code?: string }).code !== '23505') return null;
  }
  return null;
}

/**
 * Tasks made before the builder have no history. Before the first edit, keep
 * the live recipe as version 1 so it can always be restored.
 */
async function ensureBaseline(admin: SupabaseClient, task: Record<string, unknown>) {
  const jobType = String(task.job_type);
  if (await latestVersion(admin, jobType)) return;
  await insertVersion(
    admin,
    jobType,
    recipeOf(task),
    'published',
    (task.created_by as string | null) ?? null
  );
}

// ── operations ───────────────────────────────────────────────────────────────

export async function createTask(
  admin: SupabaseClient,
  a: Actor,
  input: { app_id: string; name: string; recipe: Recipe }
): Promise<Outcome<{ job_type: string; version: number }>> {
  const { data: app } = await admin
    .from('applications')
    .select('id, slug, organization_id')
    .eq('id', input.app_id)
    .maybeSingle();
  if (!app) return refuse(404, 'NOT_FOUND', 'That app was not found.');
  if (!canCreateFor(a, app as BuildableApp)) {
    return refuse(403, 'FORBIDDEN', 'You can only create AI tasks for apps you belong to.');
  }

  const key = deriveJobType(String(app.slug), input.name);
  if (!key.ok) return refuse(400, 'BAD_NAME', key.message);

  if (await loadTask(admin, key.jobType)) {
    return refuse(409, 'TASK_EXISTS', `A task called ${key.jobType} already exists. Pick another name.`);
  }

  const { error } = await admin.from('ai_tasks').insert({
    job_type: key.jobType,
    ...input.recipe,
    enabled: false, // new tasks start switched OFF (Director, 2026-10-24)
    created_by: a.userId,
    owner_app: app.id
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return refuse(409, 'TASK_EXISTS', `A task called ${key.jobType} already exists. Pick another name.`);
    }
    return refuse(500, 'CREATE_FAILED', 'Could not create the task.');
  }

  // The first version IS the live recipe (switched off), so it is "published".
  const version = await insertVersion(admin, key.jobType, input.recipe, 'published', a.userId);
  return { ok: true, data: { job_type: key.jobType, version: version ?? 1 } };
}

export async function saveDraft(
  admin: SupabaseClient,
  a: Actor,
  input: { job_type: string; recipe: Recipe }
): Promise<Outcome<{ version: number }>> {
  if (!isBuilder(a)) return NOT_A_DEVELOPER;
  const task = await loadTask(admin, input.job_type);
  if (!task) return refuse(404, 'NOT_FOUND', 'No such task.');

  await ensureBaseline(admin, task);
  const version = await insertVersion(admin, input.job_type, input.recipe, 'draft', a.userId);
  if (version == null) return refuse(500, 'SAVE_FAILED', 'Could not save the draft.');

  // TODO(ai-task-builder: test runner): queue a test run for this draft here.
  // On a pass the runner sets tested_ok_at and publishes it (see HOOK below).
  return { ok: true, data: { version } };
}

// HOOK (test runner, later PR): when a draft passes its test, the runner sets
// tested_ok_at and then publishes it: copy its recipe onto the live ai_tasks
// row, mark the version 'published', and email the owners of OTHER apps whose
// settings.ai.allowed_tasks include this task (TODO(ai-task-builder: publish
// emails)). Nothing publishes a draft until then.

export async function listVersions(
  admin: SupabaseClient,
  a: Actor,
  jobType: string
): Promise<Outcome<{ versions: (VersionRow & { created_by_email: string | null })[] }>> {
  const task = await loadTask(admin, jobType);
  if (!task) return refuse(404, 'NOT_FOUND', 'No such task.');
  if (!canSeeTask(a, task)) return refuse(403, 'FORBIDDEN', 'You cannot see this task.');

  const { data } = await admin
    .from('ai_task_versions')
    .select('*')
    .eq('job_type', jobType)
    .order('version', { ascending: false })
    .limit(50);
  const rows = (data ?? []) as VersionRow[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const emails = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin.from('profiles').select('id, email').in('id', ids);
    for (const p of (profiles ?? []) as { id: string; email: string | null }[]) {
      if (p.email) emails.set(p.id, p.email);
    }
  }
  return {
    ok: true,
    data: {
      versions: rows.map((r) => ({
        ...r,
        created_by_email: r.created_by ? emails.get(r.created_by) ?? null : null
      }))
    }
  };
}

export async function restoreVersion(
  admin: SupabaseClient,
  a: Actor,
  input: { job_type: string; version: number }
): Promise<Outcome<{ version: number; applied: boolean }>> {
  if (!isBuilder(a)) return NOT_A_DEVELOPER;
  const task = await loadTask(admin, input.job_type);
  if (!task) return refuse(404, 'NOT_FOUND', 'No such task.');

  const { data: old } = await admin
    .from('ai_task_versions')
    .select('*')
    .eq('job_type', input.job_type)
    .eq('version', input.version)
    .maybeSingle();
  if (!old) return refuse(404, 'NOT_FOUND', 'That version was not found.');
  const parsed = recipeSchema.safeParse((old as VersionRow).recipe);
  if (!parsed.success) return refuse(422, 'BAD_VERSION', 'That version cannot be restored.');

  await ensureBaseline(admin, task);

  if (a.superAdmin) {
    // Super admins restore straight onto the live row (a rollback). On/off is
    // left as it is.
    const { error } = await admin
      .from('ai_tasks')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('job_type', input.job_type);
    if (error) return refuse(500, 'RESTORE_FAILED', 'Could not restore that version.');
    const version = await insertVersion(admin, input.job_type, parsed.data, 'restored', a.userId);
    return { ok: true, data: { version: version ?? input.version, applied: true } };
  }

  // Everyone else: the old recipe becomes a new draft and waits for a test.
  const version = await insertVersion(admin, input.job_type, parsed.data, 'draft', a.userId);
  if (version == null) return refuse(500, 'RESTORE_FAILED', 'Could not restore that version.');
  return { ok: true, data: { version, applied: false } };
}

export async function switchTask(
  admin: SupabaseClient,
  a: Actor,
  input: { job_type: string; on: boolean }
): Promise<Outcome<{ enabled: boolean }>> {
  const task = await loadTask(admin, input.job_type);
  if (!task) return refuse(404, 'NOT_FOUND', 'No such task.');

  if (!input.on) {
    if (!canSeeTask(a, task)) return refuse(403, 'FORBIDDEN', 'You cannot see this task.');
    const { error } = await admin
      .from('ai_tasks')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('job_type', input.job_type);
    if (error) return refuse(500, 'UPDATE_FAILED', 'Could not switch the task off.');
    // TODO(ai-task-builder: off alerts): tell the task's owner and the owners
    // of every app using it that it was switched off, and by whom.
    return { ok: true, data: { enabled: false } };
  }

  if (!isBuilder(a)) return NOT_A_DEVELOPER;
  const latest = await latestVersion(admin, input.job_type);
  if (!latest?.tested_ok_at) {
    return refuse(
      409,
      'NOT_TESTED',
      'This task can be switched on only after a test run passes. Test runs are coming soon; until then a platform admin can switch it on.'
    );
  }
  if (!task.enabled) {
    const runners = await readRunners(admin);
    if (!runners.some((r) => runnerAlive(r))) {
      return refuse(
        409,
        'NO_WORKER',
        'No JICATE worker has checked in for over 2 minutes, so switching this on would leave every request waiting. Start the Windows workers first.'
      );
    }
  }
  const { error } = await admin
    .from('ai_tasks')
    .update({ enabled: true, updated_at: new Date().toISOString() })
    .eq('job_type', input.job_type);
  if (error) return refuse(500, 'UPDATE_FAILED', 'Could not switch the task on.');
  return { ok: true, data: { enabled: true } };
}

export async function reassignOwner(
  admin: SupabaseClient,
  a: Actor,
  input: { job_type: string; owner_email: string }
): Promise<Outcome<{ owner_id: string; owner_email: string }>> {
  if (!a.superAdmin) return refuse(403, 'FORBIDDEN', 'Only platform admins can change a task\'s owner.');
  const task = await loadTask(admin, input.job_type);
  if (!task) return refuse(404, 'NOT_FOUND', 'No such task.');

  // Exact match (auth stores emails in lower case); no ilike, whose '_' is a wildcard.
  const email = input.owner_email.trim().toLowerCase();
  const { data: person } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (!person) return refuse(404, 'NO_SUCH_USER', `No account uses ${email}.`);

  const { error } = await admin
    .from('ai_tasks')
    .update({ created_by: person.id, updated_at: new Date().toISOString() })
    .eq('job_type', input.job_type);
  if (error) return refuse(500, 'UPDATE_FAILED', 'Could not change the owner.');
  return { ok: true, data: { owner_id: String(person.id), owner_email: String(person.email) } };
}

// ── page read ────────────────────────────────────────────────────────────────

export interface TaskBuilderMeta {
  created_by: string | null;
  owner_app: string | null;
  queue_wait_seconds: number;
  required_inputs: string[];
}

/**
 * Owner, owner app and wait time per task. Read separately from the main task
 * list and tolerant of failure: before the 20261024 migration is applied these
 * columns do not exist, and the AI Models page must keep working (it then just
 * hides the builder).
 */
export async function readTaskBuilderMeta(
  admin: SupabaseClient
): Promise<Map<string, TaskBuilderMeta> | null> {
  const { data, error } = await admin
    .from('ai_tasks')
    .select('job_type, created_by, owner_app, queue_wait_seconds, required_inputs');
  if (error || !data) return null;
  return new Map(
    (data as (TaskBuilderMeta & { job_type: string })[]).map((r) => [
      r.job_type,
      {
        created_by: r.created_by,
        owner_app: r.owner_app,
        queue_wait_seconds: r.queue_wait_seconds ?? 120,
        required_inputs: r.required_inputs ?? []
      }
    ])
  );
}
