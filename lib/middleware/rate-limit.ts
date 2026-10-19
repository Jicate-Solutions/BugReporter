import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { API_ERROR_CODES } from '@boobalan_jkkn/shared';
import type { ApiRequestContext, ApiResponse } from '@boobalan_jkkn/shared';
import { createApiErrorResponse } from '@/lib/middleware/api-key-auth';

/**
 * Rate limiting for the public SDK API.
 *
 * Background: on 2026-08-07, 269 fake bug reports were inserted through
 * POST /api/v1/public/bug-reports in 5m41s, peaking at 49 rows in one second.
 * The endpoint is authenticated by an X-API-Key header only, and that key is
 * NEXT_PUBLIC_-prefixed, so it ships in the client bundle and anyone with
 * devtools can read it. The key is deliberately not rotated -- a NEXT_PUBLIC_
 * value is inherently public, so throttling is the real control, not secrecy.
 *
 * Storage: Postgres, via the fn_check_api_rate_limit RPC
 * (supabase/migrations/20260817_api_rate_limits.sql). This platform deploys to
 * Vercel serverless, so an in-process Map would be per-instance and would
 * silently fail to limit anything under real traffic. There is no Redis /
 * Upstash / Vercel KV dependency available, so the Postgres the route already
 * writes to is the only shared counter. Cost: one extra round trip per write.
 *
 * Per-app only (Director decision 2026-10-19): the limit is counted per
 * application (= per API key). There is deliberately NO per-IP limit, because
 * students on one campus network share a single public IP and would throttle
 * each other.
 */

export interface RateLimitRule {
  /** Max requests per window for the whole application (one API key). */
  applicationPerWindow: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 'application' when the app-wide bucket tripped, otherwise 'ok'. */
  scope: string;
  /** Seconds until the current window rolls over. */
  retryAfter: number;
  limit: number;
  count: number;
}

/**
 * Bug report submission: 30 per minute per app.
 *
 * Sizing, so a human can argue with it:
 *   - A genuine reporter files maybe one bug every few minutes (~0.3/min), so
 *     thirty *different* people would have to file in the same minute to trip
 *     it, which has never happened on this platform.
 *   - The 2026-08-07 attack ran ~47/min sustained with 49/second peaks. Capped
 *     at 30/min it would have landed ~180 of 269 rows over 5m41s, but the
 *     49/second burst is cut to at most 30 in any one minute window.
 */
export const BUG_SUBMISSION_RATE_LIMIT: RateLimitRule = {
  applicationPerWindow: 30,
  windowSeconds: 60
};

/**
 * Reporter conversation writes (messages, status updates on their own bug):
 * 60 per minute per app. Chat-shaped traffic bursts more naturally than bug
 * filing, so this is looser.
 */
export const REPORTER_WRITE_RATE_LIMIT: RateLimitRule = {
  applicationPerWindow: 60,
  windowSeconds: 60
};

/**
 * AI task enqueue (POST only -- GET polling is not limited): 30 per minute per
 * app, same as bug submission. No daily cap (Director decision 2026-10-19).
 */
export const AI_RUN_RATE_LIMIT: RateLimitRule = {
  applicationPerWindow: 30,
  windowSeconds: 60
};

function bucket(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Check (and consume) one unit of quota for this request.
 *
 * Keyed on the application only (one bucket per app per scope). The client IP
 * is not used: a campus shares one public IP across many students.
 *
 * The application id is used in place of the raw API key. They are 1:1 (the key
 * is looked up with .eq('api_key', ...).single()), so it identifies exactly the
 * same caller, while keeping the key itself out of a high-churn table.
 *
 * FAILURE MODE -- deliberate, and deliberately NOT the usual "fail closed":
 * if this check throws, or the RPC is missing, the request is ALLOWED and the
 * error is logged loudly. The reasoning is that the counter lives in the same
 * Postgres that the bug report insert itself writes to, so the limiter shares
 * fate with the resource it protects. If that database is unreachable, the
 * insert cannot succeed either -- denying here would add nothing except a
 * misleading 429 in place of the real error, while turning a counter blip into
 * a total outage of bug reporting. Allowing does not create an unlimited-write
 * hole, because there is nowhere for those writes to land.
 * The practical case this also covers: this code deploying before the migration
 * is applied. The endpoint then behaves exactly as it does today rather than
 * rejecting every report, so the PR is safe to merge ahead of the SQL.
 * Note this does NOT weaken the identity check -- validateApiKey still fails
 * closed on a missing or invalid key, and runs before this.
 */
export async function checkRateLimit(
  context: ApiRequestContext,
  scope: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const allow = (): RateLimitResult => ({
    allowed: true,
    scope: 'ok',
    retryAfter: 0,
    limit: rule.applicationPerWindow,
    count: 0
  });

  try {
    const applicationId = context.application.id;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase.rpc('fn_check_api_rate_limit', {
      p_bucket: bucket([scope, applicationId]),
      p_limit: rule.applicationPerWindow,
      p_window_seconds: rule.windowSeconds
    });

    if (error) {
      console.error('[RateLimit] Counter unavailable, allowing request:', {
        scope,
        error: error.message
      });
      return allow();
    }

    // RETURNS TABLE comes back as an array of rows.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error('[RateLimit] Counter returned no row, allowing request:', {
        scope
      });
      return allow();
    }

    const result: RateLimitResult = {
      allowed: row.allowed === true,
      scope: row.scope ?? 'unknown',
      retryAfter: row.retry_after ?? rule.windowSeconds,
      limit: row.limit_value ?? rule.applicationPerWindow,
      count: row.current_count ?? 0
    };

    if (!result.allowed) {
      console.warn('[RateLimit] Blocked request:', {
        scope,
        tripped: result.scope,
        application: context.application.name,
        count: result.count,
        limit: result.limit
      });
    }

    return result;
  } catch (err) {
    console.error('[RateLimit] Unexpected error, allowing request:', err);
    return allow();
  }
}

/**
 * Human-readable 429 body text for a tripped bucket.
 */
export function rateLimitMessage(result: RateLimitResult): string {
  return `This application has sent too many requests (limit ${result.limit} per minute across all users). Please retry in ${result.retryAfter} second(s).`;
}

/**
 * Route-level guard.
 *
 * Returns null when the request may proceed, or a ready-to-return 429 when it
 * may not. The denial is always explicit -- a real status code, a Retry-After
 * header and a JSON body carrying the RATE_LIMIT_EXCEEDED code -- never a
 * silent success and never a silent drop. A caller can always tell it was
 * throttled and when to try again.
 */
export async function enforceRateLimit(
  context: ApiRequestContext,
  scope: string,
  rule: RateLimitRule
): Promise<NextResponse<ApiResponse<never>> | null> {
  const result = await checkRateLimit(context, scope, rule);
  if (result.allowed) return null;

  return createApiErrorResponse<never>(
    API_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    rateLimitMessage(result),
    429,
    {
      scope: result.scope,
      limit: result.limit,
      window_seconds: rule.windowSeconds,
      retry_after_seconds: result.retryAfter
    },
    { 'Retry-After': String(result.retryAfter) }
  );
}
