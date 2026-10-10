/**
 * POST /api/internal/triage/complete — the runner hands back a verdict.
 *
 * Auth: `Authorization: Bearer <TRIAGE_RUNNER_TOKEN>` only (lib/triage/runner-auth.ts).
 *
 * Body, success:  { job_id, verdict: { type, severity, summary, likely_area, confidence } }
 *   type        bug | duplicate | feature_request | needs_info
 *   severity    low | medium | high | critical
 *   confidence  0..1
 * Body, give up:  { job_id, error: "why" }   → job re-queued (or failed after 3 tries)
 *
 * Writes ONE internal "AI triage" note on the bug, reads it back, then marks the
 * job done. If the write or read-back fails the job goes back to the queue. The
 * bug's status is never touched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRunnerAuth } from '@/lib/triage/runner-auth';
import { completeBodySchema, completeTriageJob } from '@/lib/triage/runner';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const denied = checkRunnerAuth(request);
  if (denied) return denied;

  const raw = await request.json().catch(() => null);
  const parsed = completeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message:
            'Expected { job_id, verdict: { type, severity, summary, likely_area, confidence } } or { job_id, error }.'
        }
      },
      { status: 400 }
    );
  }

  try {
    const outcome = await completeTriageJob(createAdminClient(), parsed.data);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (e) {
    console.error('[triage/complete] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: 'COMPLETE_FAILED', message: 'Could not complete the triage job.' } },
      { status: 500 }
    );
  }
}
