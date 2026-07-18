/**
 * GET /api/cron/app-routine-dispatcher
 * Vercel Cron (every 15 min): fire due app routines on the ₹0 Max lane, collect
 * finished runs, prune history older than 90 days.
 *
 * Security: Bearer CRON_SECRET (same pattern as uptime-probe).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runDispatcher } from '@/lib/routines/dispatcher';

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
    const summary = await runDispatcher(admin);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[AppRoutineDispatcher] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
