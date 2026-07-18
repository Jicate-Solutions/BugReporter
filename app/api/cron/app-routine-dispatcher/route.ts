/**
 * GET /api/cron/app-routine-dispatcher
 * Vercel Cron (every 15 min): fire due app routines on the ₹0 Max lane, collect
 * finished runs, prune history older than 90 days.
 *
 * Security: Bearer CRON_SECRET (same pattern as uptime-probe).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runDispatcher } from '@/lib/routines/dispatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Guard against an unset CRON_SECRET — otherwise the literal would be
  // "Bearer undefined" and any caller sending that would pass.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
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
