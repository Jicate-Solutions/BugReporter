/**
 * GET /api/internal/ai-engine/account-key?label=acct1 — a JICATE worker fetches
 * the key of a Claude account kept in the Control Tower.
 *
 * Auth: the worker's runner token (lib/ai-engine/runner-auth.ts) — the same
 * token that claims jobs. The worker keeps the key in memory only.
 *
 * A key is released only to a runner that is RUNNING a job right now (claimed
 * by it), so a leaked token alone, while idle, gets nothing. Every request,
 * granted or refused, is logged in ai_account_key_fetches.
 * 200 { key } · 403 no running job · 404 no key stored · 503 server not set up.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { openAccountKey } from '@/lib/ai-engine/account-keys';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin);
  if (!auth.ok) return auth.response;

  const label = new URL(request.url).searchParams.get('label') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(label)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Bad label.' } }, { status: 400 });
  }
  const [{ data: running }, { data: rr }] = await Promise.all([
    admin
      .from('ai_jobs')
      .select('id')
      .eq('claimed_by', auth.runner)
      .eq('status', 'running')
      .order('claimed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('ai_runners').select('host').eq('name', auth.runner).maybeSingle()
  ]);
  const jobId = (running as { id: string } | null)?.id ?? null;
  const host = (rr as { host: string | null } | null)?.host ?? null;
  const log = (granted: boolean, reason: string) =>
    admin.from('ai_account_key_fetches').insert({ runner: auth.runner, label, job_id: jobId, host, granted, reason });

  if (!jobId) {
    await log(false, 'no running job');
    return NextResponse.json(
      { error: { code: 'NO_RUNNING_JOB', message: 'Keys are only released while running a job.' } },
      { status: 403 }
    );
  }

  const { data } = await admin.from('ai_account_secrets').select('ciphertext').eq('label', label).maybeSingle();
  if (!data) {
    await log(false, 'no key stored');
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No key for that account.' } }, { status: 404 });
  }
  try {
    const key = openAccountKey((data as { ciphertext: string }).ciphertext);
    await log(true, 'ok');
    return NextResponse.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[ai-engine/account-key] could not open key for', label, e instanceof Error ? e.message : '');
    return NextResponse.json({ error: { code: 'KEY_UNAVAILABLE', message: 'Key could not be opened.' } }, { status: 503 });
  }
}
