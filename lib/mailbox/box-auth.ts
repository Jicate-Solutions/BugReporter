/**
 * Authentication for the box mailbox routes (/api/internal/mailbox) — and only those.
 *
 * Each JICATE computer holds one random token it generated itself; this
 * platform stores only its SHA-256, in box_mail_boxes, bound to one box name
 * (migration 20261019_box_mailbox.sql). Same model as the AI engine runner
 * tokens, but a separate table: a mailbox token cannot claim AI jobs, and a
 * runner token cannot read mail.
 *
 *   Authorization: Bearer <box token>
 *
 * The box name comes from the token's row, never from the request. Every
 * successful check records last_seen_at so the mailbox page shows who is alive.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const MIN_TOKEN_LENGTH = 32;

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type BoxAuth = { ok: true; box: string } | { ok: false; response: NextResponse };

export async function checkBoxAuth(request: Request, admin: SupabaseClient): Promise<BoxAuth> {
  if (request.headers.get('x-api-key')) {
    return { ok: false, response: fail('APP_KEY_NOT_ACCEPTED', 'Application API keys are not accepted here.', 401) };
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, response: fail('UNAUTHORIZED', 'Unauthorized.', 401) };
  }

  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  const { data, error } = await admin
    .from('box_mail_boxes')
    .select('name')
    .eq('token_sha256', digest)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) {
    console.error('[mailbox/auth] token lookup failed:', error.message);
    return { ok: false, response: fail('AUTH_UNAVAILABLE', 'Could not check the box token.', 503) };
  }
  if (!data) return { ok: false, response: fail('UNAUTHORIZED', 'Unauthorized.', 401) };

  const box = (data as { name: string }).name;
  await admin.from('box_mail_boxes').update({ last_seen_at: new Date().toISOString() }).eq('name', box);
  return { ok: true, box };
}
