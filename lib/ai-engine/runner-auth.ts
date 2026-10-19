/**
 * Authentication for the JICATE AI engine runner routes — and ONLY those routes.
 *
 * The JICATE Windows box holds one credential: JICATE_AI_RUNNER_TOKEN. It is
 * checked here and nowhere else, so it opens /api/internal/ai-engine/claim and
 * /api/internal/ai-engine/complete and nothing more. It is not a database key:
 * if it leaks, the holder can take queued AI jobs one at a time and answer them.
 * No table, no bug, nothing in MyJKKN.
 *
 *   Authorization: Bearer <JICATE_AI_RUNNER_TOKEN>
 *
 * - env unset (or too short to be a real secret) → 503. Never open.
 * - env equal to CRON_SECRET or TRIAGE_RUNNER_TOKEN → 503. One secret, one door.
 * - an X-API-Key header → 401. Application keys never drive the engine.
 * - comparison is constant-time.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export const MIN_TOKEN_LENGTH = 32;

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Returns a response to send when the caller is NOT allowed, or null when it is. */
export function checkEngineRunnerAuth(request: Request): NextResponse | null {
  const token = process.env.JICATE_AI_RUNNER_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return fail(
      'ENGINE_NOT_CONFIGURED',
      'The JICATE AI engine runner is not configured on this platform.',
      503
    );
  }
  if (
    (process.env.CRON_SECRET && token === process.env.CRON_SECRET) ||
    (process.env.TRIAGE_RUNNER_TOKEN && token === process.env.TRIAGE_RUNNER_TOKEN)
  ) {
    return fail(
      'ENGINE_NOT_CONFIGURED',
      'JICATE_AI_RUNNER_TOKEN must be its own secret, not a copy of another one.',
      503
    );
  }

  if (request.headers.get('x-api-key')) {
    return fail(
      'APP_KEY_NOT_ACCEPTED',
      'Application API keys are not accepted on the engine runner routes.',
      401
    );
  }

  const header = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  const ok = header.length === expected.length && timingSafeEqual(header, expected);
  if (!ok) return fail('UNAUTHORIZED', 'Unauthorized.', 401);
  return null;
}

/** Runner names are recorded in the DB and logs — keep them short and plain. */
export function cleanRunnerName(raw: unknown): string {
  if (typeof raw !== 'string') return 'runner';
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  return clean || 'runner';
}
