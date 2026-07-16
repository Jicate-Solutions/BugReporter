/**
 * GET /api/cron/uptime-probe
 * Vercel Cron (every 5 min): ping each app's public URL, record the result in
 * app_uptime_checks, and prune history older than 7 days.
 *
 * Security: Bearer CRON_SECRET (same pattern as generate-embeddings).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { probeApps } from '@/lib/uptime/probe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    const { data: apps, error: appsError } = await supabase
      .from('applications')
      .select('id, app_url');
    if (appsError) throw appsError;

    const { results, skipped } = await probeApps(apps ?? []);

    if (results.length > 0) {
      const { error: insertError } = await supabase.from('app_uptime_checks').insert(
        results.map((r) => ({
          application_id: r.application_id,
          ok: r.ok,
          status_code: r.status_code,
          latency_ms: r.latency_ms,
          error: r.error
        }))
      );
      if (insertError) throw insertError;
    }

    // Rolling retention: 7 days.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('app_uptime_checks').delete().lt('checked_at', cutoff);

    const up = results.filter((r) => r.ok).length;
    return NextResponse.json({
      probed: results.length,
      up,
      down: results.length - up,
      skipped_unmonitored: skipped
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[UptimeCron] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
