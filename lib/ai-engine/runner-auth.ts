/**
 * Authentication for the JICATE AI engine runner routes — and ONLY those routes.
 *
 * Each worker on the JICATE Windows box holds one random token it generated
 * itself. This platform stores only the token's SHA-256 hash, in
 * ai_runner_tokens, bound to one runner name (migration
 * 20261019_jicate_ai_engine_runner_tokens.sql). The token never travels: not
 * in chat, not in a message, not in Vercel.
 *
 *   Authorization: Bearer <runner token>
 *
 * The token opens /api/internal/ai-engine/claim, /complete and /account-key.
 * It is not a database key. If it leaks, the holder can take queued AI jobs as
 * that one runner and answer them, AND — while holding a running job — fetch
 * the keys of Claude accounts stored in the Control Tower (every fetch is
 * logged in ai_account_key_fetches and shown on AI Routines). Revoke by setting
 * revoked_at.
 *
 * - an X-API-Key header → 401. Application keys never drive the engine.
 * - missing or short token → 401. Unknown or revoked hash → 401.
 * - the runner name comes from the token's row, never from the request body.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MIN_TOKEN_LENGTH = 32;

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type RunnerAuth = { ok: true; runner: string } | { ok: false; response: NextResponse };

export async function checkEngineRunnerAuth(
  request: Request,
  admin: SupabaseClient
): Promise<RunnerAuth> {
  if (request.headers.get('x-api-key')) {
    return {
      ok: false,
      response: fail(
        'APP_KEY_NOT_ACCEPTED',
        'Application API keys are not accepted on the engine runner routes.',
        401
      )
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < MIN_TOKEN_LENGTH) {
    return { ok: false, response: fail('UNAUTHORIZED', 'Unauthorized.', 401) };
  }

  // Lookup by hash: the comparison happens on a digest, so timing reveals
  // nothing about the token itself.
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  const { data, error } = await admin
    .from('ai_runner_tokens')
    .select('runner')
    .eq('token_sha256', digest)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('[ai-engine/auth] token lookup failed:', error.message);
    return {
      ok: false,
      response: fail('AUTH_UNAVAILABLE', 'Could not check the runner token.', 503)
    };
  }
  if (!data) return { ok: false, response: fail('UNAUTHORIZED', 'Unauthorized.', 401) };
  return { ok: true, runner: (data as { runner: string }).runner };
}
