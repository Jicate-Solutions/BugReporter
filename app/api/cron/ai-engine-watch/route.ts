/**
 * GET /api/cron/ai-engine-watch
 * Vercel Cron (every 5 min): email the Director when the JICATE AI workers go
 * offline for 15 minutes (and when they're back), and at most once an hour when
 * new safety alerts are waiting. See lib/ai-engine/watch.ts.
 *
 * Security: Bearer CRON_SECRET (same pattern as app-routine-dispatcher).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runEngineWatch } from '@/lib/ai-engine/watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function authorized(request: NextRequest): boolean {
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
    const summary = await runEngineWatch(createAdminClient(), new URL(request.url).origin);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[ai-engine-watch] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
