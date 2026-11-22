/**
 * Choosing a Claude account — shared by the worker claim route (per job) and
 * the box agent route (per box, per minute), so both agree on one account.
 *
 * 'auto' = the lowest-priority-number account that still has allowance (both
 * windows under 95%, or already renewed); equal priority goes to the lowest
 * weekly usage; if none has allowance, the one that renews first.
 * "default" stands for the box's own sign-in.
 *
 * Test before moving (Director 2026-10-23): only an account read in the last
 * hour counts while one such account has allowance. The ai-engine-watch cron
 * keeps readings fresh with a tiny check job per stored account
 * (enqueueAccountProbes), so auto never jumps onto an account it hasn't heard
 * from. If no fresh account has allowance, the old rule applies, so a box is
 * never left without an account.
 *
 * A check that fails stores no reading, so the choice also looks at the check
 * itself (2026-11-20): auto never moves onto an account whose latest check
 * said its key is refused or its organisation blocks Claude Code
 * (checkSaysUnusable), until a check of it succeeds or its key is replaced.
 * Only those two: a check that was slow, hit a limit or failed for another
 * reason says nothing about the key and leaves the account in the choice.
 * For the same reason a slow or failed check never wipes out an earlier
 * verdict (2026-11-21): the choice goes by the newest check that says
 * something about the key (tellingCheck).
 *
 * A computer's name is matched without regard to capital letters (sameHost):
 * a box saved as "Biometric" and a worker reporting "biometric" are one box.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type AccountReading = {
  label: string;
  priority: number | null;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  updated_at?: string | null;
};

const FULL = 0.95;
/** A reading older than this is "not heard from"; auto skips it while a fresh one fits. */
export const FRESH_MS = 60 * 60_000;
/** The watch cron checks a stored account again once its reading is this old. */
export const PROBE_AFTER_MS = 15 * 60_000;
/** The tiny check job that reads an account's usage. Only the Control Tower enqueues it. */
export const PROBE_JOB_TYPE = 'system.account_probe';
export const PROBE_APP_SLUG = 'control-tower';

/** A reading taken before its window renewed no longer counts. */
function used(util: number | null, resets: string | null, now: number) {
  return util == null || (resets && new Date(resets).getTime() <= now) ? 0 : Number(util);
}

/** Pure choice behind pickAuto, kept apart so it can be tested. */
export function chooseAccount(readings: AccountReading[], labels: string[], now: number): string {
  const byLabel = new Map(readings.map((r) => [r.label, r]));
  const info = labels.map((l) => {
    const r = byLabel.get(l);
    const five = used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null, now);
    const week = used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null, now);
    const renews = Math.min(
      ...[r?.five_hour_resets_at, r?.seven_day_resets_at]
        .filter((t): t is string => Boolean(t))
        .map((t) => new Date(t).getTime())
        .filter((t) => t > now),
      Number.MAX_SAFE_INTEGER
    );
    const fresh = Boolean(r?.updated_at) && now - new Date(r!.updated_at as string).getTime() < FRESH_MS;
    return { l, prio: r?.priority ?? 100, five, week, ok: five < FULL && week < FULL, fresh, renews };
  });
  const order = (a: (typeof info)[number], b: (typeof info)[number]) =>
    a.prio - b.prio || a.week - b.week || a.five - b.five;
  const fresh = info.filter((a) => a.ok && a.fresh).sort(order);
  if (fresh.length) return fresh[0].l;
  const usable = info.filter((a) => a.ok).sort(order);
  if (usable.length) return usable[0].l;
  return info.sort((a, b) => a.renews - b.renews)[0].l;
}

/**
 * What one usage window's stored reading honestly says right now, for the
 * accounts card. 'renewed' = its reset time has passed, so the old percentage
 * no longer counts and there is no new reading yet.
 */
export type WindowState = 'none' | 'renewed' | 'full' | 'used';

export function windowState(util: number | null, resets: string | null, now: number): WindowState {
  if (util == null) return 'none';
  if (resets && new Date(resets).getTime() <= now) return 'renewed';
  return Number(util) >= FULL ? 'full' : 'used';
}

/**
 * How the accounts card should describe a reading's age.
 * - 'own-signin': the "default" row, each box's own sign-in, never checked automatically.
 * - 'full-until': full, so the watch cron skips it on purpose until `until`
 *   (the latest reset among the full windows); checked again right after.
 * - 'normal': show the usual "read N ago".
 */
export function readingStatus(
  r: Pick<AccountReading, 'label' | 'five_hour_util' | 'seven_day_util' | 'five_hour_resets_at' | 'seven_day_resets_at'>,
  now: number
): { kind: 'own-signin' } | { kind: 'full-until'; until: string } | { kind: 'normal' } {
  if (r.label === 'default') return { kind: 'own-signin' };
  const fullResets = [
    [r.five_hour_util, r.five_hour_resets_at],
    [r.seven_day_util, r.seven_day_resets_at]
  ] as const;
  const until = fullResets
    .filter(([u, t]) => windowState(u, t, now) === 'full' && t)
    .map(([, t]) => t as string)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return until ? { kind: 'full-until', until } : { kind: 'normal' };
}

/**
 * Stored accounts whose reading is old enough to check again. An account read
 * as full whose window has not renewed yet is skipped: checking it would only
 * hit the limit and make a worker pause.
 * `savedAt` = when each key was saved. A key saved 10 to 20 minutes ago is
 * checked whatever the age of its reading: by then no worker still remembers
 * the key before it (KEY_MEMORY_MS), so this check is surely of the new key.
 * Without it, an account kept fresh by real jobs would never be checked again
 * and its row would say "still checking" for days.
 */
export function labelsToProbe(
  readings: AccountReading[],
  labels: string[],
  now: number,
  savedAt: Map<string, string | null> = new Map()
): string[] {
  const byLabel = new Map(readings.map((r) => [r.label, r]));
  return labels.filter((l) => {
    if (l === 'default') return false; // a different account on each box
    const r = byLabel.get(l);
    const full =
      used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null, now) >= FULL ||
      used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null, now) >= FULL;
    if (full) return false;
    const saved = savedAt.get(l);
    const sinceSave = saved ? now - new Date(saved).getTime() : null;
    if (sinceSave != null && sinceSave >= KEY_MEMORY_MS && sinceSave < 2 * KEY_MEMORY_MS) return true;
    return !(r?.updated_at && now - new Date(r.updated_at).getTime() < PROBE_AFTER_MS);
  });
}

/** Queue one check job per stored account that is due. Returns the labels queued. Never throws. */
export async function enqueueAccountProbes(admin: SupabaseClient): Promise<string[]> {
  try {
    const { data: sec } = await admin.from('ai_account_secrets').select('label, added_at');
    const keys = (sec ?? []) as { label: string; added_at: string | null }[];
    const labels = keys.map((x) => x.label);
    if (!labels.length) return [];
    const { data } = await admin
      .from('ai_accounts')
      .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, updated_at')
      .in('label', labels);
    const savedAt = new Map(keys.map((k) => [k.label, k.added_at]));
    const due = labelsToProbe((data ?? []) as AccountReading[], labels, Date.now(), savedAt);
    const queued: string[] = [];
    for (const label of due) {
      const { data: out } = await admin.rpc('fn_ai_engine_enqueue', {
        p_job_type: PROBE_JOB_TYPE,
        p_application_id: null,
        p_app_slug: PROBE_APP_SLUG,
        p_organization_id: null,
        p_payload: { label },
        p_dedupe_key: `probe:${label}`,
        p_priority: 500
      });
      if ((out as { ok?: boolean } | null)?.ok) queued.push(label);
    }
    return queued;
  } catch (e) {
    console.error('[ai-engine/accounts] account checks not queued:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Queue one check of one account right now, whatever its reading says: used
 * when a key was just saved, so its result shows within about a minute instead
 * of at the next round. Runs ahead of ordinary background jobs (they queue at
 * 100; a person waiting still goes first). Returns true only when a NEW check
 * was queued. False when it was merged into a check already waiting or running
 * (a running one started before the save, so it is of the key before it), or
 * could not be queued. Never throws: saving the key must not fail because of it.
 */
export async function enqueueAccountCheck(admin: SupabaseClient, label: string): Promise<boolean> {
  try {
    const { data } = await admin.rpc('fn_ai_engine_enqueue', {
      p_job_type: PROBE_JOB_TYPE,
      p_application_id: null,
      p_app_slug: PROBE_APP_SLUG,
      p_organization_id: null,
      p_payload: { label },
      p_dedupe_key: `probe:${label}`,
      p_priority: 50
    });
    const out = data as { ok?: boolean; deduped?: boolean } | null;
    return Boolean(out?.ok) && !out?.deduped;
  } catch (e) {
    console.error('[ai-engine/accounts] account check not queued:', e instanceof Error ? e.message : e);
    return false;
  }
}

// ── What the latest check of an account said ────────────────────────────────

/** One check job (system.account_probe) as stored in ai_jobs. It never holds a key. */
export type CheckJob = {
  id?: string;
  status: string;
  error: string | null;
  claimed_at: string | null;
  completed_at: string | null;
};

/**
 * - 'working': the check ran and Claude answered.
 * - 'key-rejected': Claude refused the key itself.
 * - 'blocked': the account's organisation has switched off Claude Code.
 * - 'no-allowance': the key works, the account was at its limit.
 * - 'too-slow' / 'failed': the check did not finish, for a reason that says nothing about the key.
 * - 'not-checked': no check of the key stored now has finished.
 * - 'rechecking': a result seen so soon after the key was saved that it may come from the key before it.
 * - 'checking' / 'unknown': set by the reader (a check is waiting; the checks could not be read).
 */
export type CheckKind =
  | 'working'
  | 'key-rejected'
  | 'blocked'
  | 'no-allowance'
  | 'too-slow'
  | 'failed'
  | 'not-checked'
  | 'rechecking'
  | 'checking'
  | 'unknown';

export type CheckResult = { kind: CheckKind; at: string | null };

/** A worker remembers a key it fetched for this long (windows/jicate-ai-engine/jicate-ai-drain.mjs, keyFor). */
export const KEY_MEMORY_MS = 10 * 60_000;

/** The same limit wording the MyJKKN lanes match (windows/jicate-ai-engine/claude-acct.mjs, LIMIT_RE). */
const LIMIT_WORDS =
  /rate.?limit|usage limit|hit your [a-z0-9 -]{0,20}limit|limit reached|(?:weekly|session|5-hour) limit\W{0,3}resets|too many requests|\b429\b/;

/**
 * The class of a failed check, from Claude's own wording. The text itself is
 * never shown or returned. "Blocked" is tested first: that message also tells
 * the reader to use an API key. The key-rejected words are the worker's own
 * list (windows/jicate-ai-engine/jicate-ai-drain.mjs, AUTH_FAIL_RE) plus the
 * wording seen live on 20 Nov 2026 ("401 Invalid bearer token").
 */
function failureKind(error: string | null): CheckKind {
  const t = (error ?? '').toLowerCase();
  if (/organi[sz]ation has disabled/.test(t)) return 'blocked';
  if (
    /failed to authenticate|invalid bearer token|invalid api key|authentication_error|oauth access token|not logged in|\b401\b/.test(
      t
    )
  ) {
    return 'key-rejected';
  }
  if (LIMIT_WORDS.test(t)) return 'no-allowance';
  if (/timed out|timeout/.test(t)) return 'too-slow';
  return 'failed';
}

/**
 * What a finished check says about the key stored now. Pure.
 * `keyAddedAt` = when that key was saved (ai_account_secrets.added_at), or null
 * to take the check as it is.
 * `fetchedAfterSave` = the key log shows this check itself fetched the key
 * after it was saved (checkFetchedKey), so it surely ran on the key stored now.
 * - A check that started before the key was saved tested the key before it: it does not count.
 * - A worker remembers a fetched key for 10 minutes and forgets it only when
 *   Claude refuses the key. So within 10 minutes of a save, any other result,
 *   a pass included, may still be about the old key: 'rechecking' until a
 *   later check, unless the key log proves this check fetched the new key.
 */
export function classifyCheck(
  job: CheckJob | null,
  keyAddedAt: string | null = null,
  fetchedAfterSave = false
): CheckResult {
  if (!job || (job.status !== 'done' && job.status !== 'error')) return { kind: 'not-checked', at: null };
  const started = job.claimed_at ?? job.completed_at;
  const at = job.completed_at ?? job.claimed_at;
  const startedMs = started ? new Date(started).getTime() : null;
  const savedMs = keyAddedAt ? new Date(keyAddedAt).getTime() : null;
  if (savedMs != null && (startedMs == null || startedMs < savedMs)) return { kind: 'not-checked', at: null };
  const kind = job.status === 'done' ? 'working' : failureKind(job.error);
  const soon = savedMs != null && startedMs != null && startedMs - savedMs < KEY_MEMORY_MS;
  if (soon && kind !== 'key-rejected' && !fetchedAfterSave) return { kind: 'rechecking', at };
  return { kind, at };
}

/** A check that proves the account cannot be used at all, whatever its allowance. */
export function checkBlocksUse(kind: CheckKind): boolean {
  return kind === 'key-rejected' || kind === 'blocked';
}

/**
 * How many of an account's latest checks the chooser and the card read. A
 * rejected account is checked about every 15 minutes, so this is about two
 * hours of rounds.
 */
const CHECKS_READ = 8;

/**
 * Of an account's checks, newest first, the one to go by. Pure.
 * - A check still waiting or running is not a result: only finished ones count.
 * - A finished check that was slow, or failed for a reason that says nothing
 *   about the key, does not replace an earlier verdict. Before (found in the
 *   review of #99): one slow check after "key rejected" put the account back
 *   into "auto" until the next check.
 * - With `keyAddedAt`, checks of the key BEFORE the one stored now are left
 *   out first, so an old verdict is never carried over to a new key.
 * When every finished check was slow or failed, the newest of them is given.
 */
export function tellingCheck(jobs: CheckJob[], keyAddedAt: string | null = null): CheckJob | null {
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error');
  const ofThisKey = finished.filter((j) => classifyCheck(j, keyAddedAt).kind !== 'not-checked');
  const saysNothing = (j: CheckJob) => {
    const kind = classifyCheck(j).kind;
    return kind === 'too-slow' || kind === 'failed';
  };
  return ofThisKey.find((j) => !saysNothing(j)) ?? ofThisKey[0] ?? finished[0] ?? null;
}

const probeJobs = (admin: SupabaseClient, label: string) =>
  admin
    .from('ai_jobs')
    .select('id, status, error, claimed_at, completed_at')
    .eq('app_slug', PROBE_APP_SLUG)
    .eq('job_type', PROBE_JOB_TYPE)
    .eq('payload->>label', label);

/**
 * How far back the chooser and the card look for an account's latest check:
 * one weekly window plus a day. One number for both, so they cannot disagree.
 * It must be long: an account that reads full, or whose reading is kept fresh
 * from elsewhere, is not checked again for days, and a failed check must not
 * be forgotten in the meantime.
 */
const CHECK_LOOKBACK_MS = 8 * 24 * 60 * 60_000;

/**
 * Does the key log show that this check itself fetched the account's key after
 * the key was saved? (The account-key route logs every fetch with the id of the
 * job the worker is running.) False when there is no such row or the log cannot
 * be read: the check then stays unproven.
 */
async function checkFetchedKey(admin: SupabaseClient, job: CheckJob, label: string, keyAddedAt: string): Promise<boolean> {
  if (!job.id) return false;
  const { data, error } = await admin
    .from('ai_account_key_fetches')
    .select('id')
    .eq('job_id', job.id)
    .eq('label', label)
    .eq('granted', true)
    .gte('fetched_at', keyAddedAt)
    .limit(1);
  if (error) {
    console.error('[ai-engine/accounts] key log not read for a check of', label, '-', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** classifyCheck, asking the key log only when a result falls in the first 10 minutes after a save. */
async function classifyStoredCheck(
  admin: SupabaseClient,
  job: CheckJob | null,
  label: string,
  keyAddedAt: string | null
): Promise<CheckResult> {
  const result = classifyCheck(job, keyAddedAt);
  if (result.kind !== 'rechecking' || !job || !keyAddedAt) return result;
  return (await checkFetchedKey(admin, job, label, keyAddedAt)) ? classifyCheck(job, keyAddedAt, true) : result;
}

/**
 * True when the latest telling check of the key stored now (tellingCheck: a
 * slow or failed check is looked past) says the account cannot be used (key
 * refused, or blocked by its organisation). One small read in the usual case;
 * only when that check says "cannot be used" is the key's save time read too,
 * so a check of the key BEFORE the one stored now does not count (the same
 * rule the card uses). False when there is no such check or the checks cannot
 * be read: the choice then stays as it was.
 */
export async function checkSaysUnusable(admin: SupabaseClient, label: string, now: number): Promise<boolean> {
  try {
    const { data, error } = await probeJobs(admin, label)
      .in('status', ['done', 'error'])
      .gte('requested_at', new Date(now - CHECK_LOOKBACK_MS).toISOString())
      .order('requested_at', { ascending: false })
      .limit(CHECKS_READ);
    if (error) throw new Error(error.message);
    const finished = (data ?? []) as CheckJob[];
    if (!checkBlocksUse(classifyCheck(tellingCheck(finished)).kind)) return false;
    const { data: sec, error: e2 } = await admin.from('ai_account_secrets').select('added_at').eq('label', label).limit(1);
    if (e2) throw new Error(e2.message);
    const keyAddedAt = ((sec ?? []) as { added_at: string | null }[])[0]?.added_at ?? null;
    const latest = tellingCheck(finished, keyAddedAt);
    return checkBlocksUse((await classifyStoredCheck(admin, latest, label, keyAddedAt)).kind);
  } catch (e) {
    console.error('[ai-engine/accounts] last check not read for', label, '-', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * For the accounts card: what the last check of each stored key said.
 * - When the check "auto" goes by (tellingCheck) says the account cannot be
 *   used, the card says that too, also after a later slow or failed check: the
 *   card never shows an account as usable while "auto" passes it over.
 * - In every other case the card shows the newest finished check as it is. A
 *   slow or failed check is NOT looked past here: a run of failing checks must
 *   show as "check failed", never as an older "key works".
 * The card reads the same finished checks the chooser does (the newest
 * CHECKS_READ); the two extra rows make up for checks still waiting or running.
 * `keys` = label and when its key was saved. A check still waiting shows as
 * 'checking' only while no finished check of this key counts yet.
 */
export async function readAccountChecks(
  admin: SupabaseClient,
  keys: { label: string; added_at: string | null }[],
  now: number
): Promise<Map<string, CheckResult>> {
  const since = new Date(now - CHECK_LOOKBACK_MS).toISOString();
  const out = new Map<string, CheckResult>();
  await Promise.all(
    keys.map(async ({ label, added_at }) => {
      try {
        const { data, error } = await probeJobs(admin, label)
          .gte('requested_at', since)
          .order('requested_at', { ascending: false })
          .limit(CHECKS_READ + 2);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as CheckJob[];
        const finished = rows.filter((j) => j.status === 'done' || j.status === 'error').slice(0, CHECKS_READ);
        const newest = finished[0] ?? null;
        const telling = tellingCheck(finished, added_at);
        let result = await classifyStoredCheck(admin, telling, label, added_at);
        if (telling !== newest && !checkBlocksUse(result.kind)) {
          result = await classifyStoredCheck(admin, newest, label, added_at);
        }
        const waiting = rows.some((j) => j.status === 'queued' || j.status === 'running');
        out.set(label, result.kind === 'not-checked' && waiting ? { kind: 'checking', at: null } : result);
      } catch (e) {
        console.error('[ai-engine/accounts] last check not read for', label, '-', e instanceof Error ? e.message : e);
        out.set(label, { kind: 'unknown', at: null });
      }
    })
  );
  return out;
}

export async function pickAuto(admin: SupabaseClient, labels: string[]): Promise<string> {
  const { data } = await admin
    .from('ai_accounts')
    .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, updated_at')
    .in('label', labels);
  const readings = (data ?? []) as AccountReading[];
  const now = Date.now();
  // A pick whose latest check says it cannot be used is dropped and the choice
  // made again. Only the pick is looked up (one small read in the usual case:
  // this runs on every worker poll). "default" is never dropped, and the last
  // account standing is kept, so a box is never left without an answer.
  let pool = labels;
  for (;;) {
    const pick = chooseAccount(readings, pool, now);
    if (pick === 'default' || pool.length <= 1 || !(await checkSaysUnusable(admin, pick, now))) return pick;
    pool = pool.filter((l) => l !== pick);
  }
}

/** Two computer names are the same box whatever their capital letters ("Biometric" and "biometric"). */
export function sameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}

/** Of rows that carry a computer name, the one for `host`: its exact spelling first, else the same name in other capitals. */
export function findHost<T extends { host: string | null }>(rows: T[], host: string): T | undefined {
  return rows.find((r) => r.host === host) ?? rows.find((r) => sameHost(r.host, host));
}

/**
 * The account a whole box should use, or undefined when the box has no
 * Control Tower choice (then each worker's own setting applies).
 * Returns null for "the box's own sign-in". Records what auto resolved to.
 */
export async function resolveBoxAccount(
  admin: SupabaseClient,
  host: string | null | undefined
): Promise<string | null | undefined> {
  if (!host) return undefined;
  // Every box row is read (there are two) and matched here, so a worker that
  // reports "biometric" finds the box saved as "Biometric". Nothing stored changes.
  // In name order and capped, so the answer is the same on every poll.
  const { data } = await admin.from('ai_boxes').select('host, account, chosen_label').order('host').limit(50);
  const box = findHost((data ?? []) as { host: string; account: string | null; chosen_label: string | null }[], host);
  if (!box || box.account == null) return undefined;
  let label: string | null = box.account === 'default' ? null : box.account;
  if (box.account === 'auto') {
    const { data: sec } = await admin.from('ai_account_secrets').select('label');
    const labels = ['default', ...((sec ?? []) as { label: string }[]).map((x) => x.label)];
    const best = await pickAuto(admin, labels);
    label = best === 'default' ? null : best;
  }
  if ((box.chosen_label ?? null) !== label) {
    await admin.from('ai_boxes').update({ chosen_label: label, updated_at: new Date().toISOString() }).eq('host', box.host);
  }
  return label;
}

/**
 * MyJKKN max lanes (lane-key route, 2026-11-11). The Tower does not see the
 * lanes' own usage, so an account can read under 95% here while Claude already
 * refuses it. A lane reports each refusal (refused=<label>); the route logs it
 * and, for LANE_REFUSAL_MS, the account goes to the back of the line for every
 * lane.
 */
export const LANE_REFUSAL_MS = 30 * 60_000;

/** Per-token cap (W12, PR #93): distinct accounts handed to one lane token per rolling hour. */
export const LANE_MAX_ACCOUNTS = 3;
export const LANE_CAP_WINDOW_MS = 60 * 60_000;

export type LaneChoice = { label: string } | { label: null; retryAfterSeconds: number };

/**
 * Pure choice for a lane, kept apart from chooseAccount (which the job claim
 * and box agent use, unchanged). Among `labels` (accounts with a stored key;
 * never "default", which has no key to hand out):
 *   1. not refused in this request nor recently, under 95% — fresh reading
 *      first, then any reading, each by priority (then lowest weekly use);
 *   2. not refused, above 95% — by priority. Director 2026-11-11: use each
 *      account up to its REAL limit, so a high reading is tried before giving up;
 *   3. otherwise nothing: retry once the earliest recent refusal expires.
 */
export function chooseLaneAccount(
  readings: AccountReading[],
  labels: string[],
  refusedNow: string[],
  refusedRecently: Map<string, number>,
  now: number
): LaneChoice {
  const byLabel = new Map(readings.map((r) => [r.label, r]));
  const recent = (l: string) => {
    const at = refusedRecently.get(l);
    return at != null && now - at < LANE_REFUSAL_MS;
  };
  const info = labels
    .filter((l) => l !== 'default' && !refusedNow.includes(l) && !recent(l))
    .map((l) => {
      const r = byLabel.get(l);
      const five = used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null, now);
      const week = used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null, now);
      const fresh = Boolean(r?.updated_at) && now - new Date(r!.updated_at as string).getTime() < FRESH_MS;
      return { l, prio: r?.priority ?? 100, five, week, ok: five < FULL && week < FULL, fresh };
    });
  const order = (a: (typeof info)[number], b: (typeof info)[number]) =>
    a.prio - b.prio || a.week - b.week || a.five - b.five || a.l.localeCompare(b.l);
  const pick =
    info.filter((a) => a.ok && a.fresh).sort(order)[0] ??
    info.filter((a) => a.ok).sort(order)[0] ??
    [...info].sort(order)[0];
  if (pick) return { label: pick.l };
  const expiries = labels
    .filter((l) => l !== 'default' && recent(l))
    .map((l) => (refusedRecently.get(l) as number) + LANE_REFUSAL_MS - now);
  const wait = expiries.length ? Math.min(...expiries) : LANE_REFUSAL_MS;
  return { label: null, retryAfterSeconds: Math.max(60, Math.ceil(wait / 1000)) };
}
