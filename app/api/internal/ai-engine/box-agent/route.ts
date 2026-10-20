/**
 * /api/internal/ai-engine/box-agent — the account agent on a Windows box.
 *
 * Auth: `Authorization: Bearer <box agent token>` (box-generated; only its
 * sha256 is stored, in ai_box_agent_tokens, bound to one host). Separate from
 * worker runner tokens: a worker token can never receive box-wide keys.
 *
 *   GET  ?have=<label|default>   which account the box should use now, and
 *        `busy`: how many JICATE jobs this box's workers are running right now
 *        (the agent waits for 0 before restarting workers, so no job is cut).
 *        200 { host, label }            (label null = the box's own sign-in;
 *                                        no Control Tower choice also = null)
 *        200 { host, label, key }       only when label differs from `have`,
 *                                        so the key travels once per switch.
 *        Every key handed out is logged in ai_account_key_fetches.
 *   POST { applied, restarted? }       the agent reports what it applied.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveBoxAccount } from '@/lib/ai-engine/accounts';
import { openAccountKey } from '@/lib/ai-engine/account-keys';

export const dynamic = 'force-dynamic';

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function agentHost(request: NextRequest, admin: ReturnType<typeof createAdminClient>) {
  if (request.headers.get('x-api-key')) return null;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < 32) return null;
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  const { data } = await admin
    .from('ai_box_agent_tokens')
    .select('host')
    .eq('token_sha256', digest)
    .is('revoked_at', null)
    .maybeSingle();
  return (data as { host: string } | null)?.host ?? null;
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const host = await agentHost(request, admin);
  if (!host) return fail('UNAUTHORIZED', 'Unauthorized.', 401);

  await admin
    .from('ai_boxes')
    .upsert({ host, agent_seen_at: new Date().toISOString() }, { onConflict: 'host' });

  const choice = await resolveBoxAccount(admin, host);
  const { data: workers } = await admin.from('ai_runners').select('name').eq('host', host);
  const names = ((workers ?? []) as { name: string }[]).map((w) => w.name);
  const { count: busy } = names.length
    ? await admin
        .from('ai_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running')
        .in('claimed_by', names)
    : { count: 0 };
  const label = choice ?? null; // no choice = leave the box on its own sign-in
  const have = new URL(request.url).searchParams.get('have') ?? '';
  const haveLabel = have === '' || have === 'default' ? null : have;
  if (label === null || label === haveLabel) {
    return NextResponse.json({ host, label, busy: busy ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const log = (granted: boolean, reason: string) =>
    admin.from('ai_account_key_fetches').insert({ runner: `box-agent@${host}`, label, host, granted, reason });
  const { data } = await admin.from('ai_account_secrets').select('ciphertext').eq('label', label).maybeSingle();
  if (!data) {
    await log(false, 'box agent: no key stored');
    return fail('NOT_FOUND', `No key stored for ${label}.`, 404);
  }
  try {
    const key = openAccountKey((data as { ciphertext: string }).ciphertext);
    await log(true, 'box agent');
    return NextResponse.json({ host, label, key, busy: busy ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await log(false, 'box agent: key could not be opened');
    return fail('KEY_UNAVAILABLE', 'Key could not be opened.', 503);
  }
}

const reportSchema = z.object({
  applied: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/).nullable(),
  restarted: z.array(z.string().max(200)).max(50).optional()
});

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const host = await agentHost(request, admin);
  if (!host) return fail('UNAUTHORIZED', 'Unauthorized.', 401);
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Send { applied }.', 400);
  const now = new Date().toISOString();
  await admin
    .from('ai_boxes')
    .upsert(
      { host, applied_label: parsed.data.applied ?? 'default', applied_at: now, agent_seen_at: now },
      { onConflict: 'host' }
    );
  return NextResponse.json({ ok: true });
}
