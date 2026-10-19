/**
 * POST /api/internal/ai-engine/claim — a JICATE AI engine runner takes ONE job.
 *
 * Auth: `Authorization: Bearer <runner token>` only (lib/ai-engine/runner-auth.ts).
 * The runner name (claimed_by, heartbeat) comes from the token's row, not the body.
 *
 * 200 { job: null }                                     nothing to do
 * 200 { job: { job_id, job_type, attempts, model,
 *              output_format, timeout_ms, prompt } }    run this prompt
 *
 * The runner gets a finished prompt; the recipe lives in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { claimEngineJob } from '@/lib/ai-engine/engine';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin);
  if (!auth.ok) return auth.response;

  try {
    const job = await claimEngineJob(admin, auth.runner);
    return NextResponse.json({ job }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[ai-engine/claim] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: 'CLAIM_FAILED', message: 'Could not claim a job.' } },
      { status: 500 }
    );
  }
}
