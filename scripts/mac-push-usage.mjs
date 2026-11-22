#!/usr/bin/env node
/**
 * mac-push-usage.mjs — hand the Mac's free Claude usage readings to the
 * Control Tower, so it sees real weekly usage for every account (full ones
 * too) without running paid probe jobs.
 *
 * It makes NO call to Anthropic. It only reads the cache the Mac already
 * writes every 30 minutes (~/.config/obsidian/v5-claude-accounts.sh via
 * launchd com.omm.obsidian-v5-accounts, StartInterval 1800) and POSTs each
 * fresh reading to /api/internal/ai-engine/usage-reading.
 *
 *   node scripts/mac-push-usage.mjs --dry     print what it would send; no network, no token needed
 *   node scripts/mac-push-usage.mjs           send
 *
 * Mapping, per account in the cache:
 *   label            = the email's local part (aimech@jkkn.ac.in → aimech). The Tower
 *                      answers 404 for a label it does not have (e.g. "director"):
 *                      that is reported as "not a Tower account", never created.
 *   seven_day_util   = seven_day_pct / 100
 *   seven_day_resets_at = fetched_at + sd_reset ("in 3d 4h"), rounded UP by the unit the
 *                      cache dropped (1 h for "Xd Yh", 1 min otherwise), so a full account
 *                      never looks renewed early. An ISO sd_reset_at, if the cache ever
 *                      carries one, is used as is.
 *   five_hour_*      = the same, only when the cache has both the % and a reset time
 *   read_at          = fetched_at — so re-sending the same reading never looks fresher
 * Skipped: a reading older than 20 minutes (its fetched_at), no weekly %, or no
 * weekly reset time ('' or 'due').
 *
 * Subscription details (22 Nov 2026): ~/.claude.json knows the plan, the start
 * date and whether paid extra use is on, for the account signed in on this Mac
 * right now only. That account's reading carries them as
 *   subscription = { plan, started_on (the India calendar day), extra_use }
 * with only the parts that are known. The Tower fills its own empty fields from
 * it and never changes one an admin typed. There is no fee and no billing day
 * in that file. The other accounts get theirs when the Mac switches to them.
 * A missing or unreadable file means no subscription key; the usage push goes on.
 *
 * Settings (environment):
 *   QC_PATH            the cache (default ~/.config/obsidian/v5-quota-cache.json)
 *   CLAUDE_JSON_PATH   Claude's own settings file (default ~/.claude.json)
 *   TOWER_URL          default https://jkkn-centralized-bug-reporter.vercel.app
 *   TOWER_USAGE_TOKEN  the Mac usage token (runner "macusage-mac"); if unset it is read
 *                      from the login Keychain item "jicate-tower-macusage". Never printed.
 *
 * NOT switched on. To run every 10 minutes, a launchd agent would call
 *   /usr/bin/env node <repo>/scripts/mac-push-usage.mjs
 * with StartInterval 600 (see the PR description for the full plist and the
 * one-time token step).
 */

import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_AGE_MS = 20 * 60_000;
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const DEFAULT_URL = 'https://jkkn-centralized-bug-reporter.vercel.app';
const KEYCHAIN_ITEM = 'jicate-tower-macusage';

/** Tower label for a cache email, or null when it cannot be one. */
export function labelOf(email) {
  const local = String(email).split('@')[0].toLowerCase();
  if (!LABEL_RE.test(local) || local === 'default' || local === 'auto') return null;
  return local;
}

/**
 * 'in 3d 4h' | 'in 4h 12m' | 'in 7m' → seconds until the reset, rounded UP by
 * the unit the writer dropped. null for '', 'due' or anything else.
 */
export function relativeSeconds(text) {
  const s = String(text ?? '').trim();
  let m = /^in (\d+)d (\d+)h$/.exec(s);
  if (m) return Number(m[1]) * 86400 + Number(m[2]) * 3600 + 3600;
  m = /^in (\d+)h (\d+)m$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + 60;
  m = /^in (\d+)m$/.exec(s);
  if (m) return Number(m[1]) * 60 + 60;
  return null;
}

/** Reset time in epoch seconds: an ISO value as is, else fetched_at + the relative text. */
export function resetEpoch(iso, relative, fetchedMs) {
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return Math.ceil(t / 1000);
  }
  const secs = relativeSeconds(relative);
  return secs == null ? null : Math.ceil(fetchedMs / 1000) + secs;
}

const IST_OFFSET_MS = 5.5 * 60 * 60_000;

/** "Max 20x" / "Max 5x" from the rate-limit tier, else the plan's own name (40 characters at most). '' = not known. */
export function planText(o) {
  const tier = typeof o?.organizationRateLimitTier === 'string' ? o.organizationRateLimitTier : '';
  if (tier.includes('max_20x')) return 'Max 20x';
  if (tier.includes('max_5x')) return 'Max 5x';
  for (const v of [o?.planDisplayName, o?.organizationType]) {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40).trim();
  }
  return '';
}

/** An ISO moment → the calendar day in India, "YYYY-MM-DD". null when it is not a sane moment. */
export function indiaDay(isoText) {
  const t = typeof isoText === 'string' ? Date.parse(isoText) : NaN;
  if (!Number.isFinite(t)) return null;
  const day = new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '2000-01-01' ? day : null;
}

/**
 * What ~/.claude.json says about the signed-in account: its email (lower case)
 * and the subscription parts that are known. null when there is no account or
 * nothing is known. Pure: it is given the parsed file.
 */
export function subscriptionOf(claudeJson) {
  const o = claudeJson?.oauthAccount;
  if (!o || typeof o !== 'object' || typeof o.emailAddress !== 'string') return null;
  const subscription = {};
  const plan = planText(o);
  if (plan) subscription.plan = plan;
  const startedOn = indiaDay(o.subscriptionCreatedAt);
  if (startedOn) subscription.started_on = startedOn;
  if (typeof o.hasExtraUsageEnabled === 'boolean') subscription.extra_use = o.hasExtraUsageEnabled;
  if (!Object.keys(subscription).length) return null;
  return { email: o.emailAddress.trim().toLowerCase(), subscription };
}

/** Read the signed-in account's subscription. Any trouble (no file, not JSON, no account) = null, silently. */
export function readSubscription(path) {
  try {
    return subscriptionOf(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * The bodies to send, and what was skipped and why. Pure. `signedIn` (from
 * subscriptionOf) adds the subscription to the reading of that account only.
 */
export function buildReadings(cache, now, signedIn = null) {
  const send = [];
  const skipped = [];
  for (const [email, a] of Object.entries(cache?.accounts ?? {})) {
    const label = labelOf(email);
    if (!label) { skipped.push({ email, why: 'not a label' }); continue; }
    const fetchedMs = a?.fetched_at ? Date.parse(a.fetched_at) : NaN;
    if (!Number.isFinite(fetchedMs)) { skipped.push({ label, why: 'never read' }); continue; }
    const ageMin = Math.round((now - fetchedMs) / 60_000);
    if (now - fetchedMs > MAX_AGE_MS) { skipped.push({ label, why: `too old (${ageMin} min)` }); continue; }
    if (typeof a.seven_day_pct !== 'number') { skipped.push({ label, why: 'no weekly %' }); continue; }
    const sdReset = resetEpoch(a.sd_reset_at, a.sd_reset, fetchedMs);
    if (sdReset == null) { skipped.push({ label, why: 'no weekly reset time' }); continue; }
    const body = {
      label,
      seven_day_util: round(a.seven_day_pct / 100),
      seven_day_resets_at: sdReset,
      read_at: Math.floor(fetchedMs / 1000),
      source: 'mac'
    };
    const fhReset = resetEpoch(a.fh_reset_at, a.fh_reset, fetchedMs);
    if (typeof a.five_hour_pct === 'number' && fhReset != null) {
      body.five_hour_util = round(a.five_hour_pct / 100);
      body.five_hour_resets_at = fhReset;
    }
    if (signedIn && signedIn.email === String(email).trim().toLowerCase()) body.subscription = signedIn.subscription;
    send.push(body);
  }
  return { send, skipped };
}

/** Share of the allowance, 0-1 (the Tower refuses anything above 1). */
const round = (x) => Math.min(1, Math.max(0, Math.round(x * 10_000) / 10_000));

function token() {
  if (process.env.TOWER_USAGE_TOKEN) return process.env.TOWER_USAGE_TOKEN.trim();
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_ITEM, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000
    }).trim();
  } catch {
    return '';
  }
}

const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function describe(b) {
  const fh = b.five_hour_util != null ? ` · 5h ${b.five_hour_util} (resets ${iso(b.five_hour_resets_at)})` : '';
  const s = b.subscription;
  const sub = s
    ? ` · subscription: plan ${s.plan ?? '-'}, started ${s.started_on ?? '-'}, extra use ${s.extra_use == null ? '-' : s.extra_use ? 'on' : 'off'}`
    : '';
  return `${b.label}: week ${b.seven_day_util} (resets ${iso(b.seven_day_resets_at)}) · read ${iso(b.read_at)}${fh}${sub}`;
}

async function main(argv) {
  const dry = argv.includes('--dry');
  const path = process.env.QC_PATH || join(homedir(), '.config', 'obsidian', 'v5-quota-cache.json');
  let cache;
  try {
    cache = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`cannot read the cache ${path}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  const signedIn = readSubscription(process.env.CLAUDE_JSON_PATH || join(homedir(), '.claude.json'));
  const { send, skipped } = buildReadings(cache, Date.now(), signedIn);
  for (const s of skipped) console.log(`skip ${s.label ?? s.email}: ${s.why}`);
  if (dry) {
    for (const b of send) console.log(`would send ${describe(b)}`);
    console.log(`dry run: ${send.length} to send, ${skipped.length} skipped, nothing sent`);
    return 0;
  }
  if (!send.length) {
    console.log(`nothing fresh to send (${skipped.length} skipped)`);
    return 0;
  }
  const tok = token();
  if (!tok) {
    console.error(`no token: set TOWER_USAGE_TOKEN or the Keychain item "${KEYCHAIN_ITEM}"`);
    return 1;
  }
  const base = (process.env.TOWER_URL || DEFAULT_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    console.error('TOWER_URL must be https (plain http only for localhost)');
    return 1;
  }
  let failed = 0;
  for (const b of send) {
    try {
      const res = await fetch(`${base}/api/internal/ai-engine/usage-reading`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(15_000)
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 404) console.log(`${b.label}: not a Tower account`);
      else if (res.ok) console.log(`${b.label}: ${out.status}`);
      else { failed++; console.log(`${b.label}: HTTP ${res.status} ${out?.error?.code ?? ''}`.trim()); }
    } catch (e) {
      failed++;
      console.log(`${b.label}: ${e instanceof Error ? e.name : 'error'}`);
    }
  }
  return failed ? 1 : 0;
}

const isMain = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main(process.argv.slice(2)).then((code) => process.exit(code));
