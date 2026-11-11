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
 * A worker token opens /api/internal/ai-engine/claim, /complete and
 * /account-key. It is not a database key. If it leaks, the holder can take
 * queued AI jobs as that one runner and answer them, AND — while holding a
 * running job — fetch the keys of Claude accounts stored in the Control Tower
 * (every fetch is logged in ai_account_key_fetches and shown on AI Routines).
 * Revoke by setting revoked_at.
 *
 * LANE tokens (2026-11-11): a runner whose name starts with "maxlane-" (made
 * the same way: new-runner-token.ps1 -Runner maxlane-<box>) is a MyJKKN max
 * lane on a box, not a JICATE worker. It opens ONLY /lane-key, which hands it
 * the key of the account the Tower picks — no running job needed. The job
 * routes refuse it (403), and /lane-key refuses worker tokens (403). If a lane
 * token leaks, the holder can fetch every stored Claude account key (by
 * rolling with refused=), limited only by the rate limit; every request is
 * logged. Revoke by setting revoked_at.
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

/** Runner names with this prefix are MyJKKN max-lane tokens (see above). */
export const LANE_PREFIX = 'maxlane-';

export function isLaneRunner(runner: string): boolean {
  return runner.startsWith(LANE_PREFIX);
}

/**
 * opts.lane: true only on /lane-key. Without it a lane token is refused, so
 * it can never claim, answer or fetch a key through the job routes.
 */
export async function checkEngineRunnerAuth(
  request: Request,
  admin: SupabaseClient,
  opts: { lane?: boolean } = {}
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
  const runner = (data as { runner: string }).runner;
  if (Boolean(opts.lane) !== isLaneRunner(runner)) {
    return {
      ok: false,
      response: opts.lane
        ? fail('NOT_A_LANE_TOKEN', 'Only a max-lane token may use this route.', 403)
        : fail('LANE_TOKEN_NOT_ACCEPTED', 'A max-lane token cannot use the job routes.', 403)
    };
  }
  return { ok: true, runner };
}
