/**
 * POST /api/internal/ai-engine/usage-reading — the Mac hands in one account's
 * usage reading, read for free from the cache it already keeps.
 *
 * Auth: `Authorization: Bearer <Mac usage token>` only — a runner named
 * "macusage-*" (see lib/ai-engine/runner-auth.ts). Worker and lane tokens are
 * refused (403), and this token is refused on every other engine route.
 *
 * Body: { label, seven_day_util (0-1), seven_day_resets_at (epoch s, at most 8 days ahead),
 *         five_hour_util? + five_hour_resets_at? (both or neither), read_at (epoch s), source: 'mac',
 *         subscription?: { plan?, started_on? (YYYY-MM-DD), extra_use? } }
 *
 * subscription (the account signed in on the Mac only) fills the account's
 * EMPTY plan and start date (a value already there is never changed) and keeps
 * paid extra use as the Mac last saw it. It is applied whenever the account
 * exists, for 'stored' and 'kept_newer' alike, and a failure there never fails
 * the reading. It is checked apart from the reading: a badly shaped
 * subscription is dropped and the reading is still stored.
 *
 * 200 { status: 'stored' }      the reading is now the account's latest, and is
 *                               added to the history the card works its pace
 *                               out from (a history failure never fails this)
 * 200 { status: 'kept_newer' }  a newer reading was already stored; nothing changed
 * 400 bad reading · 404 no account with that label (never created here)
 * 422 the reading is older than 20 minutes, or from the future
 *
 * See lib/ai-engine/mac-usage.ts for what is written and why.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { fillSubscriptionFromMac, macReadingRow, macReadingSchema, macSubscriptionSchema } from '@/lib/ai-engine/mac-usage';
import { recordReadingHistory } from '@/lib/ai-engine/account-pace';

export const dynamic = 'force-dynamic';

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin, { usage: true });
  if (!auth.ok) return auth.response;

  // The reading and the subscription part are checked apart, so a bad subscription never loses a reading.
  const raw: unknown = await request.json().catch(() => null);
  const isObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const { subscription: rawSubscription, ...rawReading } = (isObject ? raw : {}) as Record<string, unknown>;
  const parsed = macReadingSchema.safeParse(isObject ? rawReading : raw);
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid body.', 400);
  const reading = parsed.data;
  const parsedSubscription = rawSubscription === undefined ? null : macSubscriptionSchema.safeParse(rawSubscription);
  const subscription = parsedSubscription?.success ? parsedSubscription.data : undefined;
  if (parsedSubscription && !parsedSubscription.success) {
    console.error('[ai-engine/usage-reading] subscription part dropped (bad shape) for', reading.label);
  }

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

  // The account exists, so every answer from here also brings its subscription fields up to date.
  // That runs AFTER the reading is settled, so it can never get in the way of the guard below.
  const done = async (status: 'stored' | 'kept_newer') => {
    await fillSubscriptionFromMac(admin, reading.label, subscription, Date.now());
    return NextResponse.json({ status }, { status: 200 });
  };

  const stored = (current as { updated_at: string | null }).updated_at;
  if (stored && Date.parse(stored) >= Date.parse(row.updated_at)) {
    return done('kept_newer');
  }

  // Guarded on the value just read, so a probe reading that lands in between is never overwritten.
  const base = admin.from('ai_accounts').update(row).eq('label', reading.label);
  const guarded = stored ? base.eq('updated_at', stored) : base.is('updated_at', null);
  const { data: updated, error: writeError } = await guarded.select('label').maybeSingle();
  if (writeError) {
    console.error('[ai-engine/usage-reading] write failed:', writeError.message);
    return fail('WRITE_FAILED', 'Could not store the reading.', 500);
  }
  if (!updated) return done('kept_newer');
  // Only a reading that was stored goes into the history, stamped with when the Mac read it.
  // The values are exactly what the Mac gave: no 5-hour number here means it gave none.
  await recordReadingHistory(admin, {
    label: reading.label,
    five_hour_util: row.five_hour_util ?? null,
    seven_day_util: row.seven_day_util,
    five_hour_resets_at: row.five_hour_resets_at ?? null,
    seven_day_resets_at: row.seven_day_resets_at,
    reported_by: row.reported_by,
    read_at: row.updated_at
  });
  return done('stored');
}
