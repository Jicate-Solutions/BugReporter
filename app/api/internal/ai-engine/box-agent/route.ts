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
 *        Every 200 also carries `files: [{ name, sha256 }]` (worker files
 *        published in ai_box_files, no content) and `workers: [{ name,
 *        last_seen_at }]` (this host's JICATE workers, for the agent's health
 *        check after a file swap) and `now` (server time, so that check does
 *        not depend on the box's clock).
 *        Every key handed out is logged in ai_account_key_fetches.
 *   GET  ?file=<name>            200 { name, sha256, signature, content } for an
 *        allow-listed file (404 otherwise). The agent checks the sha twice and
 *        the Ed25519 signature against a public key kept on the box.
 *   POST { applied, restarted?, files? }  the agent reports what it applied;
 *        `files` = { name: sha256 } it is running, stored in files_applied.
 *        Nothing here writes ai_box_files: the agent token is read-only there.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveBoxAccount } from '@/lib/ai-engine/accounts';
import { openAccountKey } from '@/lib/ai-engine/account-keys';
import { isBoxFile, SHA256_HEX } from '@/lib/ai-engine/box-files';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
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

/** Published worker files (no content). Table not there yet = no files. */
async function listFiles(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.from('ai_box_files').select('name, sha256');
  if (error || !data) return [];
  return (data as { name: string; sha256: string }[])
    .filter((f) => isBoxFile(f.name) && SHA256_HEX.test(f.sha256))
    .map((f) => ({ name: f.name, sha256: f.sha256 }));
}

async function serveFile(admin: ReturnType<typeof createAdminClient>, name: string) {
  if (!isBoxFile(name)) return fail('NOT_FOUND', 'No such file.', 404);
  const { data, error } = await admin
    .from('ai_box_files')
    .select('name, sha256, signature, content')
    .eq('name', name)
    .maybeSingle();
  if (error || !data) return fail('NOT_FOUND', 'No such file.', 404);
  const f = data as { name: string; sha256: string; signature: string; content: string };
  return NextResponse.json(
    { name: f.name, sha256: f.sha256, signature: f.signature, content: f.content },
    { headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const host = await agentHost(request, admin);
  if (!host) return fail('UNAUTHORIZED', 'Unauthorized.', 401);

  const params = new URL(request.url).searchParams;
  const fileName = params.get('file');
  if (fileName !== null) return serveFile(admin, fileName);

  await admin
    .from('ai_boxes')
    .upsert({ host, agent_seen_at: new Date().toISOString() }, { onConflict: 'host' });

  const choice = await resolveBoxAccount(admin, host);
  const { data: workerRows } = await admin.from('ai_runners').select('name, last_seen_at').eq('host', host);
  const workers = ((workerRows ?? []) as { name: string; last_seen_at: string | null }[]).map((w) => ({
    name: w.name,
    last_seen_at: w.last_seen_at ?? null
  }));
  const names = workers.map((w) => w.name);
  const { count: busy } = names.length
    ? await admin
        .from('ai_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running')
        .in('claimed_by', names)
    : { count: 0 };
  const files = await listFiles(admin);
  const label = choice ?? null; // no choice = leave the box on its own sign-in
  const have = params.get('have') ?? '';
  const haveLabel = have === '' || have === 'default' ? null : have;
  if (label === null || label === haveLabel) {
    return NextResponse.json({ host, label, busy: busy ?? 0, files, workers, now: new Date().toISOString() }, { headers: NO_STORE });
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
    return NextResponse.json({ host, label, key, busy: busy ?? 0, files, workers, now: new Date().toISOString() }, { headers: NO_STORE });
  } catch {
    await log(false, 'box agent: key could not be opened');
    return fail('KEY_UNAVAILABLE', 'Key could not be opened.', 503);
  }
}

const reportSchema = z.object({
  applied: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/).nullable(),
  restarted: z.array(z.string().max(200)).max(50).optional(),
  files: z
    .record(z.string(), z.string().regex(SHA256_HEX))
    .refine((f) => Object.keys(f).every(isBoxFile), { message: 'unknown file' })
    .optional()
});

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const host = await agentHost(request, admin);
  if (!host) return fail('UNAUTHORIZED', 'Unauthorized.', 401);
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Send { applied, files? }.', 400);
  const now = new Date().toISOString();
  await admin
    .from('ai_boxes')
    .upsert(
      { host, applied_label: parsed.data.applied ?? 'default', applied_at: now, agent_seen_at: now },
      { onConflict: 'host' }
    );
  // Separate write: if files_applied is not there yet (migration not applied),
  // only this fails and the account report above still lands.
  if (parsed.data.files) {
    await admin.from('ai_boxes').update({ files_applied: parsed.data.files }).eq('host', host);
  }
  return NextResponse.json({ ok: true });
}
