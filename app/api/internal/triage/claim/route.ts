/**
 * POST /api/internal/triage/claim — the triage runner takes ONE job.
 *
 * Auth: `Authorization: Bearer <TRIAGE_RUNNER_TOKEN>` only (lib/triage/runner-auth.ts).
 * Body (optional): { "runner": "windows-triage" } — recorded as claimed_by.
 *
 * 200 { job: null }                      nothing to do
 * 200 { job: { job_id, bug, app_name, similar, attempts } }
 *
 * The bug view is deliberately minimal — see claimTriageJob. This route is the
 * only way the Windows box sees bug text, and it never forwards anything
 * to MyJKKN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRunnerAuth } from '@/lib/triage/runner-auth';
import { claimTriageJob } from '@/lib/triage/runner';

export const dynamic = 'force-dynamic';

function runnerName(raw: unknown): string {
  if (typeof raw !== 'string') return 'runner';
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  return clean || 'runner';
}

export async function POST(request: NextRequest) {
  const denied = checkRunnerAuth(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { runner?: unknown } | null;

  try {
    const job = await claimTriageJob(createAdminClient(), runnerName(body?.runner));
    return NextResponse.json({ job }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[triage/claim] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: 'CLAIM_FAILED', message: 'Could not claim a triage job.' } },
      { status: 500 }
    );
  }
}
