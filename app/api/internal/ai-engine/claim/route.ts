/**
 * POST /api/internal/ai-engine/claim — a JICATE AI engine runner takes ONE job.
 *
 * Auth: `Authorization: Bearer <runner token>` only (lib/ai-engine/runner-auth.ts).
 * The runner name (claimed_by, heartbeat) comes from the token's row, not the body.
 *
 * 200 { job: null }                                     nothing to do
 * 200 { job: { job_id, job_type, attempts, model,
 *              output_format, timeout_ms, prompt } }    run this prompt
 * Both carry account: { use, fallback } — which Claude account label this
 * worker should run on (null = the box's own sign-in) and whether to fall back.
 *
 * Body (optional): { accounts: ["acct2", ...] } — the account labels the worker
 * holds (names only; keys never leave the box). Stored for the AI Routines page.
 *
 * The runner gets a finished prompt; the recipe lives in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { claimEngineJob } from '@/lib/ai-engine/engine';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({ accounts: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/)).max(20).optional() })
  .catch({});

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin);
  if (!auth.ok) return auth.response;

  const body = bodySchema.parse(await request.json().catch(() => ({})));

  try {
    const job = await claimEngineJob(admin, auth.runner);
    // After the claim, which has upserted this runner's heartbeat row.
    if (body.accounts) {
      await admin.from('ai_runners').update({ accounts_available: body.accounts }).eq('name', auth.runner);
    }
    const { data: r } = await admin
      .from('ai_runners')
      .select('account, account_fallback')
      .eq('name', auth.runner)
      .maybeSingle();
    const row = r as { account: string | null; account_fallback: boolean } | null;
    const account = { use: row?.account ?? null, fallback: row?.account_fallback ?? true };
    return NextResponse.json({ job, account }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[ai-engine/claim] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: 'CLAIM_FAILED', message: 'Could not claim a job.' } },
      { status: 500 }
    );
  }
}
