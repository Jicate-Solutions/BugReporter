/**
 * GET /api/cron/webhook-dispatcher
 * Vercel Cron (every 5 min): deliver queued Bug Status Portal webhooks, retry
 * failures with backoff, prune delivery history older than 90 days.
 *
 * Security: Bearer CRON_SECRET (same pattern as app-routine-dispatcher).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runWebhookDispatcher } from '@/lib/webhooks/dispatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  // Never allow "Bearer undefined" (unset secret); compare in constant time.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return header.length === expected.length && timingSafeEqual(header, expected);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const summary = await runWebhookDispatcher(admin);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[WebhookDispatcher] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
