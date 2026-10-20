/**
 * Run-now for App Routines (admin, on demand).
 *
 *   POST /api/internal/routines/run  { routineId }   → enqueue immediately (202)
 *   GET  /api/internal/routines/run?runId=…          → poll + resolve one run
 *
 * POST is admin-gated (org owner/admin or super admin). It builds the routine's
 * input with a service-role client (session-less stats), enqueues on the ₹0 Max
 * lane, and inserts a run row. GET is member-readable and, while a run is still
 * in flight, polls the Door and stores the result so the UI sees it quickly
 * (without waiting for the 15-min dispatcher tick).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { engineConfig, enqueueJob, pollJob } from '@/lib/routines/engine';
import { getRoutineKind } from '@/lib/routines/registry';

// Direct-compute kinds (buildwise.*) do the work inside this POST — the target
// app is given up to 60s to answer, so the route needs headroom beyond Vercel's
// default function duration.
export const maxDuration = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data: sa } = await supabase.from('super_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (sa) return true;
  const { data: mem } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return !!mem && (mem.role === 'owner' || mem.role === 'admin');
}

interface RoutineRow {
  id: string;
  organization_id: string;
  application_id: string | null;
  routine_kind: string;
}

export async function POST(request: NextRequest) {
  const engine = engineConfig();
  const body = (await request.json().catch(() => null)) as { routineId?: string } | null;
  if (!body?.routineId || !UUID_RE.test(body.routineId)) {
    return err('BAD_REQUEST', 'routineId (uuid) is required.', 400);
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in to run routines.', 401);

  // RLS lets any org member read the routine; existence also confirms membership.
  const { data: routine } = await supabase
    .from('app_ai_routines')
    .select('id, organization_id, application_id, routine_kind')
    .eq('id', body.routineId)
    .maybeSingle();
  if (!routine) return err('NOT_FOUND', 'No such routine in your organizations.', 404);

  const r = routine as RoutineRow;
  if (!(await isOrgAdmin(supabase, user.id, r.organization_id))) {
    return err('FORBIDDEN', 'Only org owners/admins can run routines.', 403);
  }

  const kind = getRoutineKind(r.routine_kind);
  if (!kind || kind.readOnly !== true) {
    return err('BAD_REQUEST', `Routine kind is not runnable: ${r.routine_kind}`, 400);
  }

  const admin = createAdminClient();

  // Direct-compute kinds: the answer comes back in this same request — no engine
  // job, nothing to poll. Record a terminal run row and return it immediately.
  if (kind.mode === 'direct') {
    const directBase = {
      routine_id: r.id,
      organization_id: r.organization_id,
      application_id: r.application_id,
      routine_kind: r.routine_kind,
      trigger_source: 'manual' as const
    };
    let outcome;
    try {
      outcome = await kind.execute({
        admin,
        organizationId: r.organization_id,
        applicationId: r.application_id,
        routineId: r.id
      });
    } catch (e) {
      outcome = { ok: false as const, error: e instanceof Error ? e.message : 'routine failed' };
    }
    if (!outcome.ok) {
      await admin
        .from('app_ai_routine_runs')
        .insert({ ...directBase, status: 'error', error: outcome.error, finished_at: new Date().toISOString() });
      return err('UPSTREAM_ERROR', outcome.error, 502);
    }
    const { data: run } = await admin
      .from('app_ai_routine_runs')
      .insert({ ...directBase, status: 'done', result: outcome.result, finished_at: new Date().toISOString() })
      .select('id')
      .single();
    return NextResponse.json({ status: 'done', runId: run?.id ?? null, result: outcome.result });
  }

  let input;
  try {
    input = await kind.buildInput({
      admin,
      organizationId: r.organization_id,
      applicationId: r.application_id,
      routineId: r.id
    });
  } catch (e) {
    return err('STATS_FAILED', e instanceof Error ? e.message : 'Could not read the numbers.', 500);
  }

  // Nothing to report → record an "all clear" run without an engine call.
  if (input === null) {
    const { data: run } = await admin
      .from('app_ai_routine_runs')
      .insert({
        routine_id: r.id,
        organization_id: r.organization_id,
        application_id: r.application_id,
        routine_kind: r.routine_kind,
        trigger_source: 'manual',
        status: 'done',
        result: { allClear: true },
        finished_at: new Date().toISOString()
      })
      .select('id')
      .single();
    return NextResponse.json({ status: 'done', runId: run?.id ?? null, allClear: true });
  }

  if (!engine) return err('AI_NOT_CONFIGURED', 'The AI engine is not configured yet.', 503);

  // Unique dedupe for a manual run so it always produces a fresh answer.
  const dedupeKey = `${r.routine_kind}:${r.id}:manual:${Date.now()}`;
  const { jobId, error } = await enqueueJob(engine, r.organization_id, input.task, input.payload, dedupeKey);
  const base = {
    routine_id: r.id,
    organization_id: r.organization_id,
    application_id: r.application_id,
    routine_kind: r.routine_kind,
    // Manual run-now rows must never consume the routine's daily scheduled slot;
    // the dispatcher reads this to skip stamping last_run_at when it collects one.
    trigger_source: 'manual' as const
  };
  if (!jobId) {
    await admin
      .from('app_ai_routine_runs')
      .insert({ ...base, status: 'error', error: error ?? 'enqueue failed', finished_at: new Date().toISOString() });
    return err('UPSTREAM_ERROR', error ?? 'The AI engine refused the request.', 502);
  }
  const { data: run, error: runErr } = await admin
    .from('app_ai_routine_runs')
    .insert({ ...base, status: 'running', job_id: jobId })
    .select('id')
    .single();
  if (runErr || !run) {
    // The engine job is already enqueued but we couldn't record a run row to track
    // it. Returning runId:null would send the client into a `?runId=null` 400 poll
    // loop and lose the answer. Record a best-effort error run (so the orphan is at
    // least visible) and fail loudly instead — mirrors the !jobId branch above.
    await admin
      .from('app_ai_routine_runs')
      .insert({
        ...base,
        status: 'error',
        job_id: jobId,
        error: `run-row insert failed: ${runErr?.message ?? 'unknown'}`,
        finished_at: new Date().toISOString()
      });
    return err('UPSTREAM_ERROR', 'Could not record the run. Please try again.', 502);
  }
  return NextResponse.json({ status: 'running', runId: run.id }, { status: 202 });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId') ?? '';
  if (!UUID_RE.test(runId)) return err('BAD_REQUEST', 'runId (uuid) is required.', 400);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in.', 401);

  // RLS: members read their org's runs only.
  const { data: run } = await supabase
    .from('app_ai_routine_runs')
    .select('id, organization_id, job_id, status, result, error')
    .eq('id', runId)
    .maybeSingle();
  if (!run) return err('NOT_FOUND', 'No such run.', 404);

  if (run.status === 'done' || run.status === 'error') {
    return NextResponse.json({ status: run.status, result: run.result, error: run.error });
  }

  const engine = engineConfig();
  if (!engine || !run.job_id) return NextResponse.json({ status: run.status });

  const p = await pollJob(engine, run.organization_id as string, run.job_id as string, 8000);
  const admin = createAdminClient();
  if (p.status === 'done') {
    const result = p.answer ? { answer: p.answer } : { allClear: true };
    await admin.from('app_ai_routine_runs').update({ status: 'done', result, finished_at: new Date().toISOString() }).eq('id', runId);
    return NextResponse.json({ status: 'done', result });
  }
  if (p.status === 'error' || p.status === 'canceled') {
    await admin
      .from('app_ai_routine_runs')
      .update({ status: 'error', error: p.error ?? p.status, finished_at: new Date().toISOString() })
      .eq('id', runId);
    return NextResponse.json({ status: 'error', error: p.error ?? p.status });
  }
  return NextResponse.json({ status: 'running' });
}
