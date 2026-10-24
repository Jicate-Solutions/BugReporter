/**
 * POST /api/internal/ai-engine/complete — a runner hands back one job.
 *
 * Auth: `Authorization: Bearer <runner token>` only; the runner name comes from the token.
 * Body:
 *   { job_id, answer, usage? }                 success
 *   { job_id, error, retry?, usage? }          failure (retry → back in the queue, max 3 tries)
 *   { ..., rate_limited: true }                the Max plan's limit was hit: re-queued without
 *                                              using up one of the job's 3 tries
 *   usage = { model_id?, account?, limits?, input_tokens?, output_tokens?, duration_ms?,
 *             api_cost_usd?, cache_read_tokens?, cache_write_tokens? }
 *
 * Every call writes one ledger row (ai_usage), success or failure, at ₹0, with
 * the run's API price (api_cost_usd: what the Claude API would have charged).
 * An answer the recipe cannot use (empty, or not JSON for a JSON task) is
 * recorded as a failure and retried.
 *
 * 200 { status: 'done' | 'queued' | 'error' }
 * 409 the job is not claimed by this runner (already finished, or re-queued)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { readSpecForJob, shapeResult } from '@/lib/ai-engine/engine';
import { PROBE_JOB_TYPE } from '@/lib/ai-engine/accounts';
import { legacyUsageParams, usageParams, usageSchema } from '@/lib/ai-engine/usage';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  job_id: z.uuid(),
  runner: z.string().max(200).optional(),
  answer: z.string().max(200_000).optional(),
  error: z.string().max(5_000).optional(),
  retry: z.boolean().optional(),
  rate_limited: z.boolean().optional(),
  usage: usageSchema.optional()
});

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid body.' } },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const runner = auth.runner;

  let ok = false;
  let result: Record<string, unknown> | null = null;
  let error = body.error ?? null;
  let retry = body.retry ?? false;

  if (typeof body.answer === 'string' && !body.error) {
    const spec = await readSpecForJob(admin, body.job_id);
    if (!spec) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'No such job.' } },
        { status: 404 }
      );
    }
    try {
      result = shapeResult(spec.output_format, spec.max_answer_words, body.answer);
      ok = true;
    } catch (e) {
      error = `unusable answer: ${e instanceof Error ? e.message : String(e)}`;
      retry = true;
    }
  } else if (!error) {
    error = 'runner sent neither answer nor error';
  }

  // An account check is never retried: its reading (kept below) is the point,
  // and a re-queued check of a full account would loop. The cron queues the next.
  const { data: jt } = await admin.from('ai_jobs').select('job_type').eq('id', body.job_id).maybeSingle();
  const isProbe = (jt as { job_type: string } | null)?.job_type === PROBE_JOB_TYPE;
  if (isProbe) retry = false;

  // Before completing, so a limit-reached try can never be the one that fails the job.
  if (!ok && retry && body.rate_limited) await refundAttempt(admin, body.job_id, runner);

  const base = { p_job_id: body.job_id, p_runner: runner, p_ok: ok, p_result: result, p_error: error, p_retry: retry };
  let { data, error: rpcError } = await admin.rpc('fn_ai_engine_complete', { ...base, ...usageParams(body.usage) });
  if (rpcError?.code === 'PGRST202') {
    // The database does not have the API-price params yet (20261024_usage_api_cost.sql
    // not applied): record the run the old way rather than lose it.
    ({ data, error: rpcError } = await admin.rpc('fn_ai_engine_complete', { ...base, ...legacyUsageParams(body.usage) }));
  }

  if (rpcError) {
    console.error('[ai-engine/complete] failed:', rpcError.message);
    return NextResponse.json(
      { error: { code: 'COMPLETE_FAILED', message: 'Could not record the result.' } },
      { status: 500 }
    );
  }
  const outcome = data as { ok: boolean; status?: string; error?: string };
  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: 'NOT_CLAIMED', message: 'This job is not claimed by this runner.' } },
      { status: 409 }
    );
  }
  if (body.usage?.account && !isProbe) {
    await admin.from('ai_runners').update({ account_in_use: body.usage.account }).eq('name', runner);
  }
  if (body.usage?.account && body.usage.limits) {
    await recordAccountUsage(admin, body.usage.account, body.usage.limits, runner);
  }
  if (outcome.status === 'done' && result?.safeguard === true) {
    await raiseSafetyAlert(admin, body.job_id);
  }
  return NextResponse.json({ status: outcome.status }, { status: 200 });
}

/**
 * A "limit reached" try is not the job's fault, so it should not count as one
 * of its 3 strikes. The claim added one to attempts; take it back. Guarded on
 * the value read, so a concurrent claim is never undone.
 */
async function refundAttempt(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  runner: string
) {
  const { data } = await admin
    .from('ai_jobs')
    .select('attempts')
    .eq('id', jobId)
    .eq('status', 'running')
    .eq('claimed_by', runner)
    .maybeSingle();
  const attempts = (data as { attempts: number } | null)?.attempts ?? 0;
  if (attempts <= 0) return;
  await admin
    .from('ai_jobs')
    .update({ attempts: attempts - 1 })
    .eq('id', jobId)
    .eq('status', 'running')
    .eq('claimed_by', runner)
    .eq('attempts', attempts);
}

/** Store the latest 5-hour / 7-day usage reading for one account label. */
async function recordAccountUsage(
  admin: ReturnType<typeof createAdminClient>,
  label: string,
  l: {
    five_hour?: number | null;
    seven_day?: number | null;
    five_hour_resets_at?: number | null;
    seven_day_resets_at?: number | null;
    overage_enabled?: boolean | null;
  },
  runner: string
) {
  const at = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
  const { error } = await admin.from('ai_accounts').upsert({
    label,
    five_hour_util: l.five_hour ?? null,
    seven_day_util: l.seven_day ?? null,
    five_hour_resets_at: at(l.five_hour_resets_at),
    seven_day_resets_at: at(l.seven_day_resets_at),
    overage_enabled: l.overage_enabled ?? null,
    reported_by: runner,
    updated_at: new Date().toISOString()
  });
  if (error) console.error('[ai-engine/complete] account usage not stored:', error.message);
}

/**
 * One row in ai_safety_alerts for a job whose answer carried the safety marker.
 * Never fails the job: a lost alert is logged loudly, the learner still gets
 * the kind reply.
 */
async function raiseSafetyAlert(admin: ReturnType<typeof createAdminClient>, jobId: string) {
  try {
    const { data: job } = await admin
      .from('ai_jobs')
      .select('job_type, app_slug, organization_id')
      .eq('id', jobId)
      .maybeSingle();
    if (!job) throw new Error('job not found');
    const { error } = await admin
      .from('ai_safety_alerts')
      .upsert({ job_id: jobId, ...job }, { onConflict: 'job_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(
      `[ai-engine/complete] SAFETY ALERT NOT RECORDED for job ${jobId}:`,
      e instanceof Error ? e.message : e
    );
  }
}
