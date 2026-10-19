/**
 * GET /api/internal/ai-engine/account-key?label=acct1 — a JICATE worker fetches
 * the key of a Claude account kept in the Control Tower.
 *
 * Auth: the worker's runner token (lib/ai-engine/runner-auth.ts) — the same
 * token that claims jobs. The worker keeps the key in memory only.
 * 200 { key } · 404 no key stored for that label · 503 server not set up.
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
  const { data } = await admin.from('ai_account_secrets').select('ciphertext').eq('label', label).maybeSingle();
  if (!data) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No key for that account.' } }, { status: 404 });
  }
  try {
    const key = openAccountKey((data as { ciphertext: string }).ciphertext);
    return NextResponse.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[ai-engine/account-key] could not open key for', label, e instanceof Error ? e.message : '');
    return NextResponse.json({ error: { code: 'KEY_UNAVAILABLE', message: 'Key could not be opened.' } }, { status: 503 });
  }
}
