/**
 * POST /api/internal/ai-engine/usage-reading — the Mac hands in one account's
 * usage reading, read for free from the cache it already keeps.
 *
 * Auth: `Authorization: Bearer <Mac usage token>` only — a runner named
 * "macusage-*" (see lib/ai-engine/runner-auth.ts). Worker and lane tokens are
 * refused (403), and this token is refused on every other engine route.
 *
 * Body: { label, seven_day_util (0-1), seven_day_resets_at (epoch s, at most 8 days ahead),
 *         five_hour_util? + five_hour_resets_at? (both or neither), read_at (epoch s), source: 'mac' }
 *
 * 200 { status: 'stored' }      the reading is now the account's latest
 * 200 { status: 'kept_newer' }  a newer reading was already stored; nothing changed
 * 400 bad body · 404 no account with that label (never created here)
 * 422 the reading is older than 20 minutes, or from the future
 *
 * See lib/ai-engine/mac-usage.ts for what is written and why.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { macReadingRow, macReadingSchema } from '@/lib/ai-engine/mac-usage';
import { recordUsageDay } from '@/lib/ai-engine/usage-history';

export const dynamic = 'force-dynamic';

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin, { usage: true });
  if (!auth.ok) return auth.response;

  const parsed = macReadingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid body.', 400);
  const reading = parsed.data;

  const built = macReadingRow(reading, auth.runner, Date.now());
  if (!built.ok) {
    return fail(
      built.reason === 'stale' ? 'STALE_READING' : 'FUTURE_READING',
      built.reason === 'stale' ? 'The reading is older than 20 minutes.' : 'The reading is from the future.',
      422
    );
  }
  const { row } = built;

  const { data: current, error: readError } = await admin
    .from('ai_accounts')
    .select('label, updated_at')
    .eq('label', reading.label)
    .maybeSingle();
  if (readError) {
    console.error('[ai-engine/usage-reading] read failed:', readError.message);
    return fail('READ_FAILED', 'Could not read the account.', 500);
  }
  if (!current) return fail('NOT_FOUND', 'No Control Tower account with that label.', 404);

  const stored = (current as { updated_at: string | null }).updated_at;
  if (stored && Date.parse(stored) >= Date.parse(row.updated_at)) {
    return NextResponse.json({ status: 'kept_newer' }, { status: 200 });
  }

  // Guarded on the value just read, so a probe reading that lands in between is never overwritten.
  const base = admin.from('ai_accounts').update(row).eq('label', reading.label);
  const guarded = stored ? base.eq('updated_at', stored) : base.is('updated_at', null);
  const { data: updated, error: writeError } = await guarded.select('label').maybeSingle();
  if (writeError) {
    console.error('[ai-engine/usage-reading] write failed:', writeError.message);
    return fail('WRITE_FAILED', 'Could not store the reading.', 500);
  }
  if (updated) await recordUsageDay(admin, reading.label, row.seven_day_util, row.five_hour_util);
  return NextResponse.json({ status: updated ? 'stored' : 'kept_newer' }, { status: 200 });
}
