/**
 * Authentication for the triage runner routes — and ONLY those routes.
 *
 * The Windows AI box holds one credential: TRIAGE_RUNNER_TOKEN. It is checked
 * here and nowhere else in the codebase, so it opens /api/internal/triage/claim
 * and /api/internal/triage/complete and nothing more. It is not a database key:
 * if it leaks, the holder can read one queued bug at a time (the fields
 * claim returns) and post an internal AI note — no other table, no other app.
 *
 *   Authorization: Bearer <TRIAGE_RUNNER_TOKEN>
 *
 * - env unset (or too short to be a real secret) → 503. Never open.
 * - env equal to CRON_SECRET → 503. One secret must not open two doors.
 * - an X-API-Key header → 401. Application API keys are never accepted here,
 *   even alongside a valid token, so an app can never drive its own triage.
 * - comparison is constant-time (same pattern as the cron routes).
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export const MIN_TOKEN_LENGTH = 32;

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Returns a response to send when the caller is NOT allowed, or null when it is. */
export function checkRunnerAuth(request: Request): NextResponse | null {
  const token = process.env.TRIAGE_RUNNER_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return fail(
      'TRIAGE_NOT_CONFIGURED',
      'The triage runner is not configured on this platform.',
      503
    );
  }
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
    return fail(
      'TRIAGE_NOT_CONFIGURED',
      'TRIAGE_RUNNER_TOKEN must be its own secret, not a copy of CRON_SECRET.',
      503
    );
  }

  if (request.headers.get('x-api-key')) {
    return fail(
      'APP_KEY_NOT_ACCEPTED',
      'Application API keys are not accepted on the triage runner routes.',
      401
    );
  }

  const header = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  const ok = header.length === expected.length && timingSafeEqual(header, expected);
  if (!ok) return fail('UNAUTHORIZED', 'Unauthorized.', 401);
  return null;
}
