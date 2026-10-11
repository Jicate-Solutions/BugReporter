import { NextResponse } from 'next/server';
import { PUBLIC_CORS_HEADERS } from './api-key-auth';

/**
 * KILL SWITCH for the email-scoped reporter routes (/me, /:id, /:id/messages,
 * /:id/status, /stats).
 *
 * Those routes trust the public X-API-Key (shipped to browsers) plus a
 * caller-supplied reporter_email, so anyone who knows a colleague's address
 * can read that colleague's bugs or act in their name. Until the server-key
 * fix ships, they answer 503 before any authentication or database work.
 *
 * Submitting bugs (POST /api/v1/public/bug-reports) is not wrapped and keeps
 * working.
 *
 * To lift the pause: remove the pausedForSecurityFix( ... ) wrapper from each
 * route. The original handler is left in place, untouched, for that reason.
 */
export function pausedForSecurityFix<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  void handler;
  return async () =>
    NextResponse.json(
      {
        success: false,
        error: {
          code: 'TEMPORARILY_DISABLED',
          message:
            'Viewing your reports here is paused for a security fix. Your bug reports are still being received.',
        },
      },
      { status: 503, headers: { ...PUBLIC_CORS_HEADERS } }
    );
}
