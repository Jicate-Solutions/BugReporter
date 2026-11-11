/**
 * GET /api/internal/ai-engine/lane-key — a MyJKKN max lane on a Windows box
 * asks which Claude account to run on, and gets that account's key.
 *
 * Why (Director, 11 Nov 2026 13:2x, "Let the Tower hand keys to Box 1"): Box 1's
 * ~14 MyJKKN drains ran only on the box's own sign-in; when it hit its limit at
 * 08:49 every MyJKKN job stopped. Now each Claude run on that box asks here
 * first (windows/jicate-ai-engine/claude-acct.mjs) and runs on the account the
 * Tower picks from its priority list.
 *
 * Auth: a LANE runner token only (name starts with "maxlane-", made with
 * new-runner-token.ps1; lib/ai-engine/runner-auth.ts). A JICATE worker token
 * gets 403 here, and a lane token gets 403 on claim / complete / account-key.
 *
 *   ?refused=<label>[,<label>...]  accounts Claude just refused (limit or bad
 *        key) on this run. Each is logged as a refusal and skipped by every
 *        lane for 30 minutes (LANE_REFUSAL_MS); this request picks among the rest.
 *   ?host=<computer name>          optional, for the log only.
 *
 * 200 { label, key }   run on this account (key in memory only, never logged)
 * 409 NO_ACCOUNT_LEFT  every stored account was refused; { retry_after_seconds }
 * 429 RATE_LIMITED     too many requests (Retry-After header)
 * 403 / 401            wrong or unknown token
 * 503                  counter, database, key or log could not be read or
 *                      written (fails CLOSED: no key leaves without its log row)
 *
 * Choice: chooseLaneAccount (lib/ai-engine/accounts.ts) — priority order under
 * 95% first, then accounts above 95% (used to their real limit), never one
 * refused in the last 30 min. Only accounts with a key stored in the Tower.
 * Every request — granted, refused, rate-limited — is a row in
 * ai_account_key_fetches (runner = the lane's name), shown on AI Routines.
 *
 * Rate limits, per lane token, counted in Postgres (fn_check_api_rate_limit):
 *   120 requests / minute. Box 1 runs ~14 drains; a short Claude run takes
 *   ~20 s, so 14 × 3 = 42 asks a minute at the very busiest, plus rolls.
 *   60 requests carrying refused= / 10 minutes. When an account runs out, all
 *   14 drains roll at once: 14 per account, 3 accounts = 42 at most; the
 *   30-minute memory stops the next jobs from rolling again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth, LANE_PREFIX } from '@/lib/ai-engine/runner-auth';
import { openAccountKey } from '@/lib/ai-engine/account-keys';
import { chooseLaneAccount, LANE_REFUSAL_MS } from '@/lib/ai-engine/accounts';

export const dynamic = 'force-dynamic';

const LANE_RATE = { limit: 120, windowSeconds: 60 };
const LANE_ROLL_RATE = { limit: 60, windowSeconds: 600 };

const LABEL = /^[a-z0-9][a-z0-9-]{0,30}$/;
const HOST = /^[A-Za-z0-9._-]{1,64}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Admin = ReturnType<typeof createAdminClient>;

function fail(code: string, message: string, status: number, extra: Record<string, unknown> = {}, headers = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { ...NO_STORE, ...headers } });
}

/** One unit from a Postgres counter. null = allowed; otherwise seconds to wait. Throws when the counter is unreadable. */
async function spend(admin: Admin, scope: string, runner: string, rule: { limit: number; windowSeconds: number }) {
  const { data, error } = await admin.rpc('fn_check_api_rate_limit', {
    p_bucket: createHash('sha256').update(`${scope}|${runner}`).digest('hex'),
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_after?: number } | null;
  if (!row) throw new Error('counter returned no row');
  return row.allowed === true ? null : Math.max(1, Number(row.retry_after) || rule.windowSeconds);
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin, { lane: true });
  if (!auth.ok) return auth.response;
  const runner = auth.runner;

  const params = new URL(request.url).searchParams;
  const rawHost = params.get('host') ?? '';
  const host = HOST.test(rawHost) ? rawHost : null;
  const refused = [...new Set((params.get('refused') ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (refused.length > 10 || refused.some((l) => !LABEL.test(l))) {
    return fail('BAD_REQUEST', 'Bad refused list.', 400);
  }
  /** Writes one log row; false when the row could not be written. */
  const log = async (label: string, granted: boolean, reason: string) => {
    const { error } = await admin
      .from('ai_account_key_fetches')
      .insert({ runner, label, job_id: null, host, granted, reason });
    if (error) console.error('[ai-engine/lane-key] log row not written:', error.message);
    return !error;
  };
  const unlogged = () => fail('LOG_UNAVAILABLE', 'Could not write the key log.', 503);

  // Rate limits fail CLOSED: this route hands out account keys.
  try {
    const wait =
      (await spend(admin, 'lane-key', runner, LANE_RATE)) ??
      (refused.length ? await spend(admin, 'lane-key-roll', runner, LANE_ROLL_RATE) : null);
    if (wait != null) {
      await log(refused[0] ?? '-', false, 'lane: rate limited');
      return fail('RATE_LIMITED', 'Too many requests.', 429, { retry_after_seconds: wait }, { 'Retry-After': String(wait) });
    }
  } catch (e) {
    console.error('[ai-engine/lane-key] rate counter unavailable:', e instanceof Error ? e.message : e);
    return fail('RATE_LIMIT_UNAVAILABLE', 'Could not check the rate limit.', 503);
  }

  // Claude's refusal, reported by the lane: remembered for every lane.
  // A refusal that cannot be written would be forgotten: fail closed.
  for (const label of refused) {
    if (!(await log(label, false, 'lane: refused by claude'))) return unlogged();
  }

  const since = new Date(Date.now() - LANE_REFUSAL_MS).toISOString();
  const [sec, acc, recent] = await Promise.all([
    admin.from('ai_account_secrets').select('label'),
    admin
      .from('ai_accounts')
      .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, updated_at'),
    admin
      .from('ai_account_key_fetches')
      .select('label, fetched_at')
      .like('runner', `${LANE_PREFIX}%`)
      .eq('reason', 'lane: refused by claude')
      .gte('fetched_at', since)
  ]);
  if (sec.error || acc.error || recent.error) {
    console.error('[ai-engine/lane-key] could not read accounts');
    return fail('ACCOUNTS_UNAVAILABLE', 'Could not read the accounts.', 503);
  }
  const labels = ((sec.data ?? []) as { label: string }[]).map((x) => x.label);
  const refusedAt = new Map<string, number>();
  for (const r of (recent.data ?? []) as { label: string; fetched_at: string }[]) {
    const t = new Date(r.fetched_at).getTime();
    if (t > (refusedAt.get(r.label) ?? 0)) refusedAt.set(r.label, t);
  }
  const readings = (acc.data ?? []) as Parameters<typeof chooseLaneAccount>[0];
  const choice = chooseLaneAccount(readings, labels, refused, refusedAt, Date.now());

  if (choice.label === null) {
    await log('-', false, 'lane: no account left');
    return fail('NO_ACCOUNT_LEFT', 'Every stored account was refused recently.', 409, {
      retry_after_seconds: choice.retryAfterSeconds
    });
  }

  const { data } = await admin.from('ai_account_secrets').select('ciphertext').eq('label', choice.label).maybeSingle();
  if (!data) {
    await log(choice.label, false, 'lane: no key stored');
    return fail('KEY_UNAVAILABLE', 'Key could not be read.', 503);
  }
  let key: string;
  try {
    key = openAccountKey((data as { ciphertext: string }).ciphertext);
  } catch (e) {
    console.error('[ai-engine/lane-key] could not open key for', choice.label, e instanceof Error ? e.message : '');
    await log(choice.label, false, 'lane: key could not be opened');
    return fail('KEY_UNAVAILABLE', 'Key could not be opened.', 503);
  }
  // No key leaves without its log row.
  if (!(await log(choice.label, true, refused.length ? 'lane: ok after refusal' : 'lane: ok'))) return unlogged();
  return NextResponse.json({ label: choice.label, key }, { headers: NO_STORE });
}
