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
 *        not depend on the box's clock), and `commands: [{ id, verb, payload,
 *        signature }]` (this box's queued, unexpired ai_box_commands rows,
 *        oldest first, at most 5; the agent verifies each signed payload).
 *        Before listing, this box's queued rows past expires_at become
 *        'expired', and its running rows more than 15 minutes past
 *        expires_at become 'failed' (result { reason: 'agent stopped' }).
 *        Every key handed out is logged in ai_account_key_fetches.
 *   GET  ?file=<name>            200 { name, sha256, signature, content } for an
 *        allow-listed file (404 otherwise). The agent checks the sha twice and
 *        the Ed25519 signature against a public key kept on the box.
 *   POST { applied?, restarted?, files?, command_update?, status_report? }
 *        any combination, at least one of applied / files / command_update /
 *        status_report. `applied` (when the key is sent) = the account the
 *        agent applied; `files` = { name: sha256 } it is running, stored in
 *        files_applied. `command_update` = { id, status: running | done |
 *        failed | refused, result? } for one of THIS box's commands; a
 *        terminal row never moves (answer says moved: false). `status_report`
 *        = the agent's status report, stored in ai_boxes.status_report.
 *        Nothing here writes ai_box_files: the agent token is read-only there.
 *
 * Box keys (2026-10-26, lib/ai-engine/box-keys.ts):
 *   Every 200 GET also carries `box_keys: [{ id, file, name, set_at }]`: this
 *        box's keys saved in the Tower and not yet delivered or failed, for
 *        allow-listed targets only. No value.
 *   GET  ?box_key=<id>   200 { id, file, name, set_at, value } for one of those
 *        (404 otherwise). Logged in ai_account_key_fetches.
 *   POST { box_key_update: { id, set_at, status: delivered | failed, reason? } }
 *        marks that key delivered (or failed, with a short reason) when
 *        set_at still matches, so a key replaced meanwhile stays pending.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveBoxAccount } from '@/lib/ai-engine/accounts';
import { openAccountKey } from '@/lib/ai-engine/account-keys';
import { isBoxFile, SHA256_HEX } from '@/lib/ai-engine/box-files';
import { BOX_KEY_TARGETS, openBoxKey, resolveBoxKeyTarget } from '@/lib/ai-engine/box-keys';
import {
  AGENT_STOPPED,
  commandUpdateSchema,
  MAX_COMMANDS_PER_POLL,
  RUNNING_GRACE_MS,
  selectQueued,
  statusReportSchema,
  transition,
  type CommandRow
} from '@/lib/ai-engine/box-commands';

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

/**
 * This box's queued commands. First, for this box only: queued rows past
 * expires_at become 'expired', and running rows more than 15 minutes past
 * expires_at become 'failed' ({ reason: 'agent stopped' }), so a dead agent
 * cannot leave a row running forever. Table not there yet = no commands.
 */
async function listCommands(admin: ReturnType<typeof createAdminClient>, host: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    await admin
      .from('ai_box_commands')
      .update({ status: 'expired', finished_at: nowIso })
      .eq('box', host)
      .eq('status', 'queued')
      .lte('expires_at', nowIso);
    await admin
      .from('ai_box_commands')
      .update({ status: 'failed', finished_at: nowIso, result: AGENT_STOPPED })
      .eq('box', host)
      .eq('status', 'running')
      .lt('expires_at', new Date(now.getTime() - RUNNING_GRACE_MS).toISOString());
    const { data, error } = await admin
      .from('ai_box_commands')
      .select('id, verb, payload, signature, status, expires_at, created_at')
      .eq('box', host)
      .eq('status', 'queued')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(MAX_COMMANDS_PER_POLL);
    if (error || !data) return [];
    return selectQueued(data as CommandRow[], now);
  } catch {
    return [];
  }
}

/**
 * This box's box keys waiting for delivery (no value), allow-listed targets
 * only. Table not there yet = none.
 */
async function listBoxKeys(admin: ReturnType<typeof createAdminClient>, host: string) {
  const targets = BOX_KEY_TARGETS.filter((t) => t.host.toLowerCase() === host.toLowerCase());
  if (targets.length === 0) return [];
  try {
    const { data, error } = await admin
      .from('ai_box_keys')
      .select('host, target_id, set_at')
      .eq('host', targets[0].host)
      .in('target_id', targets.map((t) => t.id))
      .is('delivered_at', null)
      .is('delivery_error', null);
    if (error || !data) return [];
    return (data as { host: string; target_id: string; set_at: string }[]).flatMap((r) => {
      const t = resolveBoxKeyTarget(host, r.target_id);
      return t && t.host === r.host ? [{ id: t.id, file: t.file, name: t.name, set_at: r.set_at }] : [];
    });
  } catch {
    return [];
  }
}

/** One pending box key, with its value. Logged in ai_account_key_fetches. */
async function serveBoxKey(admin: ReturnType<typeof createAdminClient>, host: string, id: string) {
  const t = resolveBoxKeyTarget(host, id);
  if (!t) return fail('NOT_FOUND', 'No such key.', 404);
  const log = (granted: boolean, reason: string) =>
    admin.from('ai_account_key_fetches').insert({ runner: `box-agent@${host}`, label: t.id, host, granted, reason });
  const { data, error } = await admin
    .from('ai_box_keys')
    .select('ciphertext, set_at')
    .eq('host', t.host)
    .eq('target_id', t.id)
    .is('delivered_at', null)
    .is('delivery_error', null)
    .maybeSingle();
  if (error || !data) return fail('NOT_FOUND', 'No such key.', 404);
  const row = data as { ciphertext: string; set_at: string };
  let value: string;
  try {
    value = openBoxKey(row.ciphertext);
  } catch {
    await log(false, 'box key could not be opened');
    return fail('KEY_UNAVAILABLE', 'Key could not be opened.', 503);
  }
  await log(true, 'box key');
  await admin
    .from('ai_box_keys')
    .update({ fetched_at: new Date().toISOString() })
    .eq('host', t.host)
    .eq('target_id', t.id);
  return NextResponse.json({ id: t.id, file: t.file, name: t.name, set_at: row.set_at, value }, { headers: NO_STORE });
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
  const boxKeyId = params.get('box_key');
  if (boxKeyId !== null) return serveBoxKey(admin, host, boxKeyId);

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
  const commands = await listCommands(admin, host);
  const box_keys = await listBoxKeys(admin, host);
  const label = choice ?? null; // no choice = leave the box on its own sign-in
  const have = params.get('have') ?? '';
  const haveLabel = have === '' || have === 'default' ? null : have;
  if (label === null || label === haveLabel) {
    return NextResponse.json(
      { host, label, busy: busy ?? 0, files, workers, commands, box_keys, now: new Date().toISOString() },
      { headers: NO_STORE }
    );
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
    return NextResponse.json(
      { host, label, key, busy: busy ?? 0, files, workers, commands, box_keys, now: new Date().toISOString() },
      { headers: NO_STORE }
    );
  } catch {
    await log(false, 'box agent: key could not be opened');
    return fail('KEY_UNAVAILABLE', 'Key could not be opened.', 503);
  }
}

const reportSchema = z
  .object({
    // Optional so a command update or status report alone does not overwrite
    // the applied account; null still means "the box's own sign-in".
    applied: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/).nullable().optional(),
    restarted: z.array(z.string().max(200)).max(50).optional(),
    files: z
      .record(z.string(), z.string().regex(SHA256_HEX))
      .refine((f) => Object.keys(f).every(isBoxFile), { message: 'unknown file' })
      .optional(),
    command_update: commandUpdateSchema.optional(),
    status_report: statusReportSchema.optional(),
    box_key_update: z
      .object({
        id: z.string().max(64),
        set_at: z.string().min(10).max(40),
        status: z.enum(['delivered', 'failed']),
        // Fixed wording from the agent (e.g. "file missing"); never a value.
        reason: z.string().regex(/^[A-Za-z0-9 ,.:()_-]{1,200}$/).optional()
      })
      .optional()
  })
  .refine(
    (b) =>
      b.applied !== undefined ||
      b.files !== undefined ||
      b.command_update !== undefined ||
      b.status_report !== undefined ||
      b.box_key_update !== undefined,
    { message: 'empty report' }
  );

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const host = await agentHost(request, admin);
  if (!host) return fail('UNAUTHORIZED', 'Unauthorized.', 401);
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      'BAD_REQUEST',
      'Send { applied?, files?, command_update?, status_report?, box_key_update? } (at least one).',
      400
    );
  }
  const body = parsed.data;
  const now = new Date().toISOString();
  await admin
    .from('ai_boxes')
    .upsert(
      body.applied !== undefined
        ? { host, applied_label: body.applied ?? 'default', applied_at: now, agent_seen_at: now }
        : { host, agent_seen_at: now },
      { onConflict: 'host' }
    );
  // Separate writes: if a column or table is not there yet (migration not
  // applied), only that write fails and the account report above still lands.
  if (body.files) {
    await admin.from('ai_boxes').update({ files_applied: body.files }).eq('host', host);
  }
  if (body.status_report) {
    await admin.from('ai_boxes').update({ status_report: body.status_report, status_at: now }).eq('host', host);
  }
  let command: { id: string; moved: boolean } | undefined;
  if (body.command_update) {
    const u = body.command_update;
    const step = transition(u.status, now);
    const patch: Record<string, unknown> = { status: u.status, ...step.set };
    if (u.result !== undefined) patch.result = u.result;
    // One guarded statement: only this box's row, only from a non-terminal state.
    const { data, error } = await admin
      .from('ai_box_commands')
      .update(patch)
      .eq('id', u.id)
      .eq('box', host)
      .in('status', step.from)
      .select('id');
    command = { id: u.id, moved: !error && Array.isArray(data) && data.length > 0 };
  }
  let boxKey: { id: string; moved: boolean } | undefined;
  if (body.box_key_update) {
    const u = body.box_key_update;
    const t = resolveBoxKeyTarget(host, u.id);
    let moved = false;
    if (t) {
      const patch =
        u.status === 'delivered'
          ? { delivered_at: now, delivery_error: null }
          : { delivered_at: null, delivery_error: (u.reason ?? 'failed').slice(0, 200) };
      // Only this box's row, only the value it fetched, only while still pending.
      const { data, error } = await admin
        .from('ai_box_keys')
        .update(patch)
        .eq('host', t.host)
        .eq('target_id', t.id)
        .eq('set_at', u.set_at)
        .is('delivered_at', null)
        .is('delivery_error', null)
        .select('target_id');
      moved = !error && Array.isArray(data) && data.length > 0;
    }
    boxKey = { id: u.id, moved };
  }
  return NextResponse.json({ ok: true, ...(command ? { command } : {}), ...(boxKey ? { box_key: boxKey } : {}) });
}
