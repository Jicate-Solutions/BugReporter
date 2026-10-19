/**
 * POST /api/internal/ai-engine/complete — a runner hands back one job.
 *
 * Auth: `Authorization: Bearer <JICATE_AI_RUNNER_TOKEN>` only.
 * Body:
 *   { job_id, runner, answer, usage? }                 success
 *   { job_id, runner, error, retry?, usage? }          failure (retry → back in the queue, max 3 tries)
 *   usage = { model_id?, input_tokens?, output_tokens?, duration_ms? }
 *
 * Every call writes one ledger row (ai_usage), success or failure, at ₹0.
 * An answer the recipe cannot use (empty, or not JSON for a JSON task) is
 * recorded as a failure and retried.
 *
 * 200 { status: 'done' | 'queued' | 'error' }
 * 409 the job is not claimed by this runner (already finished, or re-queued)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth, cleanRunnerName } from '@/lib/ai-engine/runner-auth';
import { readSpecForJob, shapeResult } from '@/lib/ai-engine/engine';

export const dynamic = 'force-dynamic';

const intOrNull = z.number().int().nonnegative().max(2_000_000_000).nullable().optional();

const bodySchema = z.object({
  job_id: z.uuid(),
  runner: z.string().max(200).optional(),
  answer: z.string().max(200_000).optional(),
  error: z.string().max(5_000).optional(),
  retry: z.boolean().optional(),
  usage: z
    .object({
      model_id: z.string().max(100).nullable().optional(),
      input_tokens: intOrNull,
      output_tokens: intOrNull,
      duration_ms: intOrNull
    })
    .optional()
});

export async function POST(request: NextRequest) {
  const denied = checkEngineRunnerAuth(request);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid body.' } },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const runner = cleanRunnerName(body.runner);
  const admin = createAdminClient();

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

  const { data, error: rpcError } = await admin.rpc('fn_ai_engine_complete', {
    p_job_id: body.job_id,
    p_runner: runner,
    p_ok: ok,
    p_result: result,
    p_error: error,
    p_retry: retry,
    p_model_id: body.usage?.model_id ?? null,
    p_input_tokens: body.usage?.input_tokens ?? null,
    p_output_tokens: body.usage?.output_tokens ?? null,
    p_duration_ms: body.usage?.duration_ms ?? null
  });

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
  return NextResponse.json({ status: outcome.status }, { status: 200 });
}
