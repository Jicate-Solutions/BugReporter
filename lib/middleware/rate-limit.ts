import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
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
 */

export interface RateLimitRule {
  /** Max requests per window for one (application + client IP) pair. */
  identityPerWindow: number;
  /** Max requests per window for the whole application, across every IP. */
  applicationPerWindow: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Which bucket tripped: 'identity' (app+IP), 'application' (app-wide), or 'ok'. */
  scope: string;
  /** Seconds until the current window rolls over. */
  retryAfter: number;
  limit: number;
  count: number;
}

/**
 * Bug report submission.
 *
 * Sizing, so a human can argue with it:
 *   - A genuine reporter files maybe one bug every few minutes (~0.3/min).
 *     5/min for one person on one machine is >15x that headroom, and still
 *     allows a frantic burst of five related bugs in a minute.
 *   - 30/min application-wide means thirty *different* people would have to
 *     file simultaneously to trip it, which has never happened on this
 *     platform.
 *   - The 2026-08-07 attack ran ~47/min sustained with 49/second peaks. From a
 *     single IP it would have been cut from 269 reports to ~28 over the same
 *     5m41s (about a 90% reduction), and the 49/second peak is cut by ~98%.
 *     To reach even the 30/min application ceiling the attacker now needs six
 *     or more distinct IPs, and is still capped there.
 */
export const BUG_SUBMISSION_RATE_LIMIT: RateLimitRule = {
  identityPerWindow: 5,
  applicationPerWindow: 30,
  windowSeconds: 60
};

/**
 * Reporter conversation writes (notes, status updates on their own bug).
 * Chat-shaped traffic bursts more naturally than bug filing, so this is looser.
 * Both are still ~1000x below the observed attack rate.
 */
export const REPORTER_WRITE_RATE_LIMIT: RateLimitRule = {
  identityPerWindow: 10,
  applicationPerWindow: 60,
  windowSeconds: 60
};

/**
 * AI task enqueue. Same shape as bug submission -- each call costs real money
 * downstream, so there is no reason to be looser than the cheapest write.
 */
export const AI_RUN_RATE_LIMIT: RateLimitRule = {
  identityPerWindow: 5,
  applicationPerWindow: 30,
  windowSeconds: 60
};

/**
 * Best-effort client IP.
 *
 * On Vercel, x-forwarded-for is set by the platform edge and its first entry is
 * the real client. If no IP can be determined at all, every such caller shares
 * the literal 'unknown' bucket -- that fails toward *stricter*, which is the
 * right direction for a limiter.
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function bucket(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Check (and consume) one unit of quota for this request.
 *
 * Keyed on BOTH the API key and the client IP, because either alone is
 * trivially defeated: one API key is shared by every browser running that app,
 * and one IP is defeated by rotating IPs while reusing the key. Two buckets are
 * counted and both must pass.
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
  request: NextRequest,
  context: ApiRequestContext,
  scope: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const allow = (): RateLimitResult => ({
    allowed: true,
    scope: 'ok',
    retryAfter: 0,
    limit: rule.identityPerWindow,
    count: 0
  });

  try {
    const applicationId = context.application.id;
    const ip = clientIp(request);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase.rpc('fn_check_api_rate_limit', {
      p_identity_bucket: bucket([scope, applicationId, ip]),
      p_identity_limit: rule.identityPerWindow,
      p_key_bucket: bucket([scope, applicationId]),
      p_key_limit: rule.applicationPerWindow,
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
      limit: row.limit_value ?? rule.identityPerWindow,
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
  if (result.scope === 'application') {
    return `This application has sent too many requests (limit ${result.limit} per minute across all users). Please retry in ${result.retryAfter} second(s).`;
  }
  return `Too many requests (limit ${result.limit} per minute). Please retry in ${result.retryAfter} second(s).`;
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
  request: NextRequest,
  context: ApiRequestContext,
  scope: string,
  rule: RateLimitRule
): Promise<NextResponse<ApiResponse<never>> | null> {
  const result = await checkRateLimit(request, context, scope, rule);
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
