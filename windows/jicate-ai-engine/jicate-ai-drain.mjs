// ============================================================================
// JICATE AI engine - drain (JICATE Windows AI box)
// ----------------------------------------------------------------------------
// Takes ONE job at a time from the JICATE Control Tower (the central bug
// reporter), runs the finished prompt it is given through the Max-seat Claude
// CLI (headless `claude -p`, Rs 0), and hands the answer back. The recipe and the
// prompt are built by the server; this file never needs to change when a task
// is added or reworded.
//
// WHY THIS IS NOT THE MyJKKN DRAIN: Director, 2026-10-19 - JICATE AI work runs
// on JICATE's own engine, not in MyJKKN's database or queue. This drain talks
// only to two Control Tower routes.
//
// LEAST PRIVILEGE: this box holds NO database key. Each worker holds one random
// token that setup generated ON THIS BOX; the Control Tower stores only its
// SHA-256 hash, bound to this worker's name. The token never leaves the box.
// It opens exactly two routes:
//   POST {JICATE_AI_URL}/api/internal/ai-engine/claim     -> { job } | { job: null }
//   POST {JICATE_AI_URL}/api/internal/ai-engine/complete  -> { status }
// If the token leaks, the holder can take queued AI jobs as this one worker and
// answer them. It cannot read any table, any bug, or anything in MyJKKN.
// Revoke it in the Control Tower (ai_runner_tokens.revoked_at) and it stops.
//
// LESSONS CARRIED OVER FROM THE MyJKKN MAX LANE
// - The claim reply is an envelope; the server unwraps {job, spec} and sends a
//   ready job. `job: null` means idle - never misread as an error.
// - Person-waiting (interactive) jobs are ordered first by the server; this
//   drain polls every IDLE_MS (default 3 s) so a reply lands well inside 60 s.
// - Per-job credential file: NOT NEEDED here. Jobs run with no tools, so no
//   user token is ever written to disk. If a tool-using task is ever added,
//   give each job its own randomly named credential file, deleted in a finally.
// - Timeouts kill with SIGKILL (a polite signal can leave claude.exe alive).
// - Every run is reported to /complete, success or failure, so the usage
//   ledger (ai_usage) has a row for every run and the Models page shows Rs 0.
// - Always-on = Task Scheduler TimeTrigger every minute + IgnoreNew, never
//   AtLogOn alone. Prove it by killing the process, not by reading the task.
//
// ENV (from ENV_FILE, default <runner>.env next to this script - exactly two lines):
//   JICATE_AI_URL=https://jkkn-centralized-bug-reporter.vercel.app
//   JICATE_AI_RUNNER_TOKEN=<generated on this box by new-runner-token.ps1>
// Optional process env (set by run-jicate-ai-drain.cmd): SANDBOX, IDLE_MS,
//   RUNNER, CLAUDE_BIN, ONESHOT=1, ACCOUNTS_DIR.
//
// Claude accounts: the box's own sign-in is "default". An extra account's key
// is either kept in the Control Tower (added on the AI Routines page; fetched
// here on demand and held in memory only) or in a file
// <ACCOUNTS_DIR>\<label>.token (saved by save-claude-account.mjs). The
// worker tells the Control Tower which labels it has (names only, never keys);
// the Control Tower says which one to use and whether to fall back to the
// others when an account hits its limit or its key stops working.
//
// USAGE
//   SELFTEST=1 node jicate-ai-drain.mjs  # one local "pong" through claude, no server
//   ONESHOT=1 node jicate-ai-drain.mjs   # take at most one job, then exit
//   node jicate-ai-drain.mjs             # forever loop (Task Scheduler)
// ============================================================================

import { execFile } from 'node:child_process';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir, hostname } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.ENV_FILE || resolve(HERE, `${process.env.RUNNER || 'jicate-1'}.env`);

/**
 * Read one key from a dotenv file. Strips whitespace, surrounding quotes and a
 * trailing LITERAL "\n" - values pasted from other tools have arrived that way
 * before and produce a token that silently never matches.
 */
function fromEnvFile(key) {
  try {
    for (const raw of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/^\uFEFF/, '');
      if (line.startsWith(`${key}=`)) {
        return line
          .slice(key.length + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/(?:\\[rn])+$/g, '')
          .trim();
      }
    }
  } catch { /* fall through */ }
  return '';
}

const BASE       = (process.env.JICATE_AI_URL || fromEnvFile('JICATE_AI_URL')).replace(/\/+$/, '');
const TOKEN      = process.env.JICATE_AI_RUNNER_TOKEN || fromEnvFile('JICATE_AI_RUNNER_TOKEN');
// For logs only: the server takes the runner name from the token, not from us.
const RUNNER     = process.env.RUNNER || 'jicate-1';
const ONESHOT    = process.env.ONESHOT === '1';
const IDLE_MS    = Number(process.env.IDLE_MS || 3000);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// OUTSIDE any repo: `claude -p` walks up from its cwd and loads any CLAUDE.md
// or .claude settings it finds.
const SANDBOX    = process.env.SANDBOX || join(tmpdir(), 'jicate-ai-sandbox');
// Pause after every account hit its limit: 1 min, doubling each time it happens
// again in a row, up to 30 min; back to 1 min after the next job that works.
const RATE_LIMIT_PAUSE_MS = 60_000;
const RATE_LIMIT_PAUSE_MAX_MS = 30 * 60_000;
const ACCOUNTS_DIR = process.env.ACCOUNTS_DIR || resolve(HERE, 'accounts');
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
// After an account hits its limit, skip it for 30 min; after its key fails, 6 h.
const COOLDOWN_LIMIT_MS = 30 * 60_000;
const COOLDOWN_AUTH_MS = 6 * 60 * 60_000;
const cooling = new Map(); // label -> until (ms)
let noEffortFlag = false;   // set once if this box's CLI rejects --effort
let centralLabels = [];     // accounts whose key the Control Tower holds
const keyCache = new Map(); // label -> { key, at } (memory only, 10 min)

const SELFTEST   = process.env.SELFTEST === '1';

if (!SELFTEST && (!BASE || !TOKEN)) {
  console.error(`[jicate-ai] missing JICATE_AI_URL or JICATE_AI_RUNNER_TOKEN (looked in ${ENV_FILE})`);
  process.exit(1);
}

const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), '[jicate-ai]', ...a);
const logErr = (...a) => console.error(ts(), '[jicate-ai]', ...a);

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  if (!r.ok) {
    const msg = data?.error?.message || text.slice(0, 200);
    const err = new Error(`${path} -> ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

class RunError extends Error {
  constructor(message, { retry = false, rateLimited = false, authFailed = false } = {}) {
    super(message);
    this.retry = retry;
    this.rateLimited = rateLimited;
    this.authFailed = authFailed;
  }
}

const RATE_LIMIT_RE = /rate.?limit|usage limit|too many requests|\b429\b|overloaded/i;
const AUTH_FAIL_RE = /failed to authenticate|oauth access token|invalid api key|not logged in|\b401\b/i;
// Short reason for the log when an account is skipped: the error's first 160
// chars with anything key-like removed (sk-ant-... and any 32+ char run of
// base64/hex-like characters). Never the key itself.
function redactReason(msg) {
  return String(msg ?? '')
    .replace(/sk-ant-[A-Za-z0-9_\-+/=]*/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/=_\-]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Labels of the extra accounts on this box (file names only). */
function listAccounts() {
  try {
    return readdirSync(ACCOUNTS_DIR)
      .filter((f) => f.endsWith('.token'))
      .map((f) => f.slice(0, -'.token'.length))
      .filter((l) => LABEL_RE.test(l) && l !== 'default')
      .sort();
  } catch {
    return [];
  }
}

/** One account's key: a local file first, else the Control Tower (cached 10 min). */
async function keyFor(label) {
  try {
    const k = readFileSync(join(ACCOUNTS_DIR, `${label}.token`), 'utf8').trim();
    if (k) return k;
  } catch { /* no local file */ }
  const hit = keyCache.get(label);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.key;
  if (!centralLabels.includes(label)) return '';
  try {
    const r = await fetch(`${BASE}/api/internal/ai-engine/account-key?label=${encodeURIComponent(label)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    });
    const d = r.ok ? await r.json() : null;
    if (d?.key) {
      keyCache.set(label, { key: d.key, at: Date.now() });
      return d.key;
    }
  } catch { /* treated as no key */ }
  return '';
}

/** Environment for one account: its key, or the box's own sign-in for "default". */
async function envFor(label) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (label === 'default') return env;
  const key = await keyFor(label);
  if (!key) throw new RunError(`account ${label}: no key on this box or in the Control Tower`, { retry: true, authFailed: true });
  env.CLAUDE_CODE_OAUTH_TOKEN = key;
  return env;
}

/**
 * One headless Claude call on the Max seat. No tools, no MCP, no hooks, no
 * skills, no transcript on disk. Returns { answer, usage }.
 */
async function runClaude(job, label = 'default') {
  mkdirSync(SANDBOX, { recursive: true });
  const env = await envFor(label);
  const args = [
    '-p', '--model', job.model, '--output-format', 'stream-json', '--verbose',
    '--restricted',              // ignore project/local settings and hooks
    '--strict-mcp-config',       // no MCP servers
    '--no-session-persistence',  // no transcript on disk
    '--disable-slash-commands',  // no skills
    '--allowedTools', '',        // pure text: no files, no shell, no network
  ];
  // Effort chosen per task on the AI Models page; skipped when the CLI on this
  // box is too old to know the flag (see runWithAccounts).
  if (job.effort && /^(low|medium|high|xhigh|max)$/.test(job.effort) && !noEffortFlag) {
    args.push('--effort', job.effort);
  }
  const timeout = Math.max(10_000, Number(job.timeout_ms) || 120_000);
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      CLAUDE_BIN, args,
      { cwd: SANDBOX, env, timeout, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          return reject(new RunError(`timed out after ${timeout} ms`, { retry: true }));
        }
        // stream-json: one JSON object per line. The "result" line carries the
        // answer; the "rate_limit_event" line carries this account's 5-hour and
        // weekly allowance used (older CLIs may not send it).
        let d = null;
        let rl = null;
        for (const line of String(stdout).split(/\r?\n/)) {
          if (!line.startsWith('{')) continue;
          let o;
          try { o = JSON.parse(line); } catch { continue; }
          if (o.type === 'result') d = o;
          else if (o.type === 'rate_limit_event') rl = o.rate_limit_info;
        }
        const w = rl?.unifiedWindows;
        const limits = w ? {
          five_hour: Number.isFinite(w.five_hour?.utilization) ? w.five_hour.utilization : null,
          seven_day: Number.isFinite(w.seven_day?.utilization) ? w.seven_day.utilization : null,
          five_hour_resets_at: Number.isFinite(w.five_hour?.resetsAt) ? w.five_hour.resetsAt : null,
          seven_day_resets_at: Number.isFinite(w.seven_day?.resetsAt) ? w.seven_day.resetsAt : null,
          overage_enabled: typeof rl.overageEnabled === 'boolean' ? rl.overageEnabled : null,
        } : null;
        if (!d) {
          const msg = String(stderr || err?.message || stdout || 'no output').slice(0, 300);
          return reject(new RunError(`claude failed: ${msg}`, {
            retry: true, rateLimited: RATE_LIMIT_RE.test(msg), authFailed: AUTH_FAIL_RE.test(msg),
          }));
        }
        // modelUsage also lists the CLI's side-work model (Haiku), in no fixed
        // order. Record the model asked for, else the one that wrote the most.
        const mu = d.modelUsage || {};
        const ids = Object.keys(mu);
        const answered = ids.find((id) => id.includes(job.model))
          || ids.sort((a, b) => (mu[b]?.outputTokens || 0) - (mu[a]?.outputTokens || 0))[0];
        const num = (v) => (Number.isFinite(v) ? v : null);
        // What the API would have charged for this run (all models, cache included),
        // as Claude reports it; we pay nothing extra on a subscription.
        const cost = { api_cost_usd: num(d.total_cost_usd),
          cache_read_tokens: num(answered ? mu[answered].cacheReadInputTokens : d.usage?.cache_read_input_tokens),
          cache_write_tokens: num(answered ? mu[answered].cacheCreationInputTokens : d.usage?.cache_creation_input_tokens) };
        const usage = answered
          ? { model_id: answered, input_tokens: num(mu[answered].inputTokens),
              output_tokens: num(mu[answered].outputTokens), ...cost, limits }
          : { model_id: job.model, input_tokens: num(d.usage?.input_tokens),
              output_tokens: num(d.usage?.output_tokens), ...cost, limits };
        if (d.is_error) {
          const msg = String(d.result ?? d.subtype ?? 'error').slice(0, 300);
          const limited = RATE_LIMIT_RE.test(msg);
          return reject(Object.assign(
            new RunError(`claude error: ${msg}`, {
              retry: true, rateLimited: limited, authFailed: !limited && AUTH_FAIL_RE.test(msg),
            }),
            { usage },
          ));
        }
        resolvePromise({ answer: String(d.result ?? '').trim(), usage });
      },
    );
    child.stdin.end(job.prompt);
  });
}

// A run that works on a label ends its cool-down, even when it was run anyway
// because no other account was ready.
function clearCooling(label) {
  const wasCooling = cooling.get(label) > Date.now();
  cooling.delete(label);
  if (wasCooling) log(`account ${label} works again; cool-down cleared`);
}

/**
 * Run the job on the chosen account; with fallback on, move to the next
 * account when one hits its limit or its key fails. Order: chosen, the other
 * extra accounts, then the box's own sign-in. Returns { answer, usage, label }.
 */
async function runWithAccounts(job, choice) {
  const chosen = choice?.use && LABEL_RE.test(choice.use) ? choice.use : 'default';
  const all = [chosen, ...listAccounts(), ...centralLabels, 'default'].filter((l, i, a) => a.indexOf(l) === i);
  const order = choice?.fallback === false ? [chosen] : all;
  const now = Date.now();
  const ready = order.filter((l) => !(cooling.get(l) > now));
  const tryList = ready.length ? ready : [chosen];
  let lastErr;
  for (const label of tryList) {
    try {
      const out = await runClaude(job, label);
      clearCooling(label);
      return { ...out, label };
    } catch (e) {
      if (!noEffortFlag && job.effort && /unknown option.*effort/i.test(String(e?.message))) {
        noEffortFlag = true;
        logErr('this Claude CLI does not know --effort; running without it from now on');
        try {
          const out = await runClaude(job, label);
          clearCooling(label);
          return { ...out, label };
        } catch (e2) {
          e = e2;
        }
      }
      lastErr = e;
      if (e && typeof e === 'object') e.account = label;
      if (!(e?.rateLimited || e?.authFailed)) throw e;
      cooling.set(label, Date.now() + (e.authFailed ? COOLDOWN_AUTH_MS : COOLDOWN_LIMIT_MS));
      if (e.authFailed) keyCache.delete(label); // fetch afresh next time: the key may have been replaced
      logErr(`account ${label} ${e.authFailed ? 'key failed' : 'hit its limit'} (${redactReason(e.message)}); ${tryList.length > 1 ? 'trying the next account' : 'no other account to try'}`);
    }
  }
  throw lastErr;
}

async function drainOnce() {
  const { job, account } = await post('/api/internal/ai-engine/claim', { accounts: listAccounts(), host: hostname() });
  if (Array.isArray(account?.central)) {
    centralLabels = account.central.filter((l) => LABEL_RE.test(l));
    for (const l of keyCache.keys()) if (!centralLabels.includes(l)) keyCache.delete(l); // key removed in the Tower
  }
  if (!job) return { worked: false };

  // Log ids only - never the payload or the answer.
  log(`claimed ${job.job_id} ${job.job_type} attempt=${job.attempts} model=${job.model} effort=${job.effort || 'default'} account=${account?.use || 'default'}`);
  const started = Date.now();
  try {
    const { answer, usage, label } = await runWithAccounts(job, account);
    if (!answer) throw new RunError('claude returned empty output', { retry: true });
    const done = await post('/api/internal/ai-engine/complete', {
      job_id: job.job_id, answer,
      usage: { ...usage, account: label, duration_ms: Date.now() - started },
    });
    log(`DONE ${job.job_id} status=${done?.status} in ${Date.now() - started}ms type=${job.job_type} model=${usage.model_id} api_cost_usd=${usage.api_cost_usd ?? 'n/a'}`);
    return { worked: true };
  } catch (e) {
    // Keys never reach the log or the server, even in a raw CLI error.
    const msg = String(e?.message || e).replace(/sk-ant-[A-Za-z0-9_\-+/=]*/gi, '[redacted]').slice(0, 900);
    logErr(`FAIL ${job.job_id}: ${msg}${e?.rateLimited ? ' RATE-LIMITED' : ''}`);
    // Report it so the ledger records the failed run and the job is retried
    // (the server gives up after 3 attempts).
    await post('/api/internal/ai-engine/complete', {
      job_id: job.job_id, error: msg, retry: e?.retry !== false,
      rate_limited: Boolean(e?.rateLimited),
      usage: { ...(e?.usage || {}), ...(e?.account ? { account: e.account } : {}), duration_ms: Date.now() - started },
    }).catch((e2) => logErr(`release failed: ${String(e2?.message || e2).slice(0, 200)}`));
    return { worked: true, rateLimited: Boolean(e?.rateLimited) };
  }
}

async function selftest() {
  // Proves claude.exe path, the Max sign-in and the locked-down flags on this box.
  const started = Date.now();
  const { answer, usage } = await runClaude({
    model: 'sonnet', timeout_ms: 120_000, prompt: 'Reply with exactly: pong',
  });
  log(`SELFTEST answer=${JSON.stringify(answer)} model=${usage.model_id} in ${Date.now() - started}ms`);
  if (answer.toLowerCase().replace(/[^a-z]/g, '') !== 'pong') process.exit(2);
}

async function main() {
  if (SELFTEST) return selftest();
  log(`start runner=${RUNNER} url=${BASE} idle=${IDLE_MS}ms oneshot=${ONESHOT} bin=${CLAUDE_BIN}`);
  let netFails = 0;
  let limitHits = 0;
  let lastAlive = Date.now();
  for (;;) {
    let outcome = { worked: false };
    try {
      outcome = await drainOnce();
      if (netFails) log(`server reachable again after ${netFails} failed tries`);
      netFails = 0;
    } catch (e) {
      logErr(`claim error: ${String(e?.message || e).slice(0, 300)}`);
      if ([401, 404, 503].includes(e?.status)) {
        // 401 = token not registered yet / revoked; 404 = server not deployed yet;
        // 503 = server misconfigured. Slow down instead of hammering.
        await new Promise((r) => setTimeout(r, 60_000));
      } else {
        // No answer, or the server failed (500, 502 ...): the internet or the
        // server is down. Wait longer each time (10 s, 20 s, 40 s ... up to
        // 5 min) instead of retrying every 3 s.
        netFails += 1;
        const wait = Math.min(10_000 * 2 ** (netFails - 1), 300_000);
        logErr(`server not answering properly (try ${netFails}); waiting ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (ONESHOT) break;
    // One "alive" line a minute, so a quiet log still shows the worker is fine.
    if (Date.now() - lastAlive >= 60_000) {
      log(`alive ok runner=${RUNNER}`);
      lastAlive = Date.now();
    }
    if (outcome.rateLimited) {
      limitHits += 1;
      const pause = Math.min(RATE_LIMIT_PAUSE_MS * 2 ** (limitHits - 1), RATE_LIMIT_PAUSE_MAX_MS);
      log(`pausing ${pause / 1000}s after a rate limit (hit ${limitHits} in a row)`);
      await new Promise((r) => setTimeout(r, pause));
    } else if (outcome.worked) {
      limitHits = 0;
    } else {
      await new Promise((r) => setTimeout(r, IDLE_MS));
    }
  }
}

main().catch((e) => {
  logErr(`fatal: ${String(e?.message || e)}`);
  process.exit(1);
});
