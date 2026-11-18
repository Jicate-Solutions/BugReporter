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
 * Settings (environment):
 *   QC_PATH            the cache (default ~/.config/obsidian/v5-quota-cache.json)
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

/** The bodies to send, and what was skipped and why. Pure. */
export function buildReadings(cache, now) {
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
  return `${b.label}: week ${b.seven_day_util} (resets ${iso(b.seven_day_resets_at)}) · read ${iso(b.read_at)}${fh}`;
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
  const { send, skipped } = buildReadings(cache, Date.now());
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
