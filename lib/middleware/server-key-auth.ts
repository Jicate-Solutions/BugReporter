import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { ApiResponse, ApiRequestContext } from '@boobalan_jkkn/shared';
import { withApiKeyAuth, createApiErrorResponse } from './api-key-auth';

/**
 * Server-key authentication for the email-scoped reporter routes.
 *
 * Why this exists. The X-API-Key is shipped to browsers as NEXT_PUBLIC_*, so it
 * proves which application is calling and nothing about who. The routes that
 * read or act on ONE reporter's bugs (/me, /:id, /:id/messages, /:id/status,
 * /stats) trusted that key plus a caller-supplied `reporter_email`. Anyone who
 * knew a colleague's email could read their bugs and write in their name.
 *
 * Those routes now also require X-Server-Key: a second, per-application secret
 * that lives only on the integrating app's SERVER. Only its SHA-256 is stored
 * (applications.server_key_hash), issued by fn_issue_app_server_key.
 *
 * X-Server-Key is deliberately NOT in PUBLIC_CORS_HEADERS' allowed headers, so
 * a browser cannot send it cross-origin even if someone leaked it into one.
 *
 * Fails closed: no header, wrong key, an app with no key set, or any lookup
 * error (including the column not existing yet) all answer 401.
 */

export const SERVER_KEY_HEADER = 'X-Server-Key';

const SERVER_KEY_MESSAGE =
  "This endpoint must be called from your app's server with its server key, not from a browser.";

/** SHA-256 hex of a server key, matching the migration's encode(sha256(...), 'hex'). */
export function hashServerKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented key against a stored SHA-256 hex. */
export function serverKeyMatches(
  presented: string,
  storedHash: string | null | undefined
): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashServerKey(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Check the request's X-Server-Key against the application's stored hash.
 * Returns null when it matches, or the 401 response to send.
 */
export async function checkServerKey<T>(
  request: NextRequest,
  applicationId: string
): Promise<NextResponse<ApiResponse<T>> | null> {
  const presented = request.headers.get(SERVER_KEY_HEADER);
  if (!presented) {
    return createApiErrorResponse<T>('SERVER_KEY_REQUIRED', SERVER_KEY_MESSAGE, 401);
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase
      .from('applications')
      .select('server_key_hash')
      .eq('id', applicationId)
      .single();

    if (error) {
      console.error('[ServerKeyAuth] Lookup failed:', error.message);
    }

    const storedHash = (data as { server_key_hash?: string | null } | null)
      ?.server_key_hash;

    if (!error && serverKeyMatches(presented, storedHash)) {
      return null;
    }
  } catch (err) {
    console.error('[ServerKeyAuth] Unexpected error:', err);
  }

  // Wrong key, no key configured for this app, and lookup failure all look the
  // same to the caller: one answer, so the response says nothing about which.
  return createApiErrorResponse<T>('INVALID_SERVER_KEY', SERVER_KEY_MESSAGE, 401);
}

/**
 * withApiKeyAuth plus the server key. Use on every route that is scoped to one
 * reporter by a caller-supplied email.
 */
export function withServerKeyAuth<T = unknown>(
  handler: (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => Promise<NextResponse<ApiResponse<T>>>
) {
  return withApiKeyAuth<T>(async (request, context, routeContext) => {
    const refusal = await checkServerKey<T>(request, context.application.id);
    if (refusal) return refusal;
    return handler(request, context, routeContext);
  });
}
