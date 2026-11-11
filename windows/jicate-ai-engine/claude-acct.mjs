#!/usr/bin/env node
/**
 * claude-acct.mjs — stands in for claude.exe for the MyJKKN max lanes on a box.
 *
 * Director, 11 Nov 2026 13:2x: "Let the Tower hand keys to Box 1". Each drain's
 * CLAUDE_BIN points here (through claude-acct.cmd or claude-acct.exe). For every
 * Claude run this:
 *   1. reads the drain's stdin to the end (the prompt), so it can be replayed;
 *   2. asks the Control Tower which account to use
 *      (GET /api/internal/ai-engine/lane-key, lane runner token);
 *   3. runs the REAL claude.exe with the SAME arguments, unchanged (so the
 *      drain's fences — allowed tools, settings, model — stay exactly as they
 *      were), with CLAUDE_CODE_OAUTH_TOKEN set ONLY in that child's environment;
 *   4. if Claude refuses the account (usage limit or bad key), asks again with
 *      refused=<label> and runs on the next account — at most once per account;
 *   5. hands the drain the output of the LAST run only, and its exit code.
 *
 * Floor: if the Tower cannot be reached, refuses, rate-limits, or has no
 * account left, the run goes ahead exactly as before this shim (the box's own
 * sign-in / whatever environment the drain already had).
 *
 * The key is held in memory only: never written to disk, never logged, never
 * put on a command line. The log line per run (logs\claude-acct.log next to
 * this file) carries the account label, attempt count and exit code only.
 *
 * Settings (environment of the drain, or defaults):
 *   CLAUDE_REAL_BIN   the real claude.exe   (default C:\Users\Admin\.local\bin\claude.exe)
 *   TOWER_LANE_ENV    file with JICATE_AI_URL= and JICATE_AI_RUNNER_TOKEN=
 *                     (default C:\jicate-ai\maxlane-biometric.env, made by
 *                     new-runner-token.ps1 -Runner maxlane-biometric)
 *   CLAUDE_ACCT_LOG   log file             (default <this folder>\logs\claude-acct.log)
 *   CLAUDE_ACCT_OFF=1 skip the Tower entirely (instant undo without touching drains)
 */

import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_BIN = process.env.CLAUDE_REAL_BIN || 'C:\\Users\\Admin\\.local\\bin\\claude.exe';
const ENV_FILE = process.env.TOWER_LANE_ENV || 'C:\\jicate-ai\\maxlane-biometric.env';
const LOG_FILE = process.env.CLAUDE_ACCT_LOG || join(HERE, 'logs', 'claude-acct.log');
const ASK_TIMEOUT_MS = Number(process.env.CLAUDE_ACCT_ASK_TIMEOUT_MS) || 15_000;
const STDIN_WAIT_MS = 3_000;
const MAX_ATTEMPTS = 6;

// Same patterns as jicate-ai-drain.mjs, minus "overloaded" (a server-wide
// state; another account would not help).
export const LIMIT_RE = /rate.?limit|usage limit|hit your limit|limit reached|too many requests|\b429\b/i;
export const AUTH_RE = /failed to authenticate|oauth access token|invalid api key|not logged in|\b401\b/i;

function log(line) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  } catch { /* logging must never break a run */ }
}

function readEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * The drain's stdin, whole. A drain that never writes or closes stdin would
 * hang us, so with no first byte within 3 s we take it as empty (claude.exe
 * itself does the same).
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((done) => {
    const chunks = [];
    let started = false;
    const timer = setTimeout(() => {
      if (!started) finish();
    }, STDIN_WAIT_MS);
    function finish() {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(Buffer.concat(chunks));
    }
    process.stdin.on('data', (c) => {
      started = true;
      chunks.push(c);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

/** Ask the Tower. Returns { label, key } or { none: reason }. Never throws. */
async function askTower(cfg, refused) {
  const q = new URLSearchParams({ host: hostname().slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '-') });
  if (refused.length) q.set('refused', refused.join(','));
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/internal/ai-engine/lane-key?${q}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.label === 'string' && typeof body.key === 'string' && body.key.length > 20) {
      return { label: body.label, key: body.key };
    }
    return { none: `tower ${res.status} ${body?.error?.code ?? ''}`.trim() };
  } catch (e) {
    return { none: `tower unreachable (${e?.name ?? 'error'})` };
  }
}

/** One run of the real claude.exe. Output is buffered, not passed on yet. */
function runClaude(args, env, input) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(REAL_BIN, args, {
        env,
        stdio: [input === null ? 'inherit' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      done({ code: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(`claude-acct: cannot start ${REAL_BIN}: ${e.message}\n`) });
      return;
    }
    current = child;
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => err.push(Buffer.from(`claude-acct: cannot start ${REAL_BIN}: ${e.message}\n`)));
    child.on('close', (code, signal) => {
      current = null;
      done({ code: code ?? (signal ? 1 : 0), stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    if (input !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * Why a finished run failed, if it is the account's fault: 'limit', 'auth' or
 * null. Only a failed run counts (non-zero exit, or a JSON result with
 * is_error) — the text of a good answer is never matched. stream-json's
 * rate_limit_event lines (present on every run) are ignored.
 */
export function refusalOf(run) {
  const outText = run.stdout.toString('utf8');
  const lines = outText.split(/\r?\n/).filter((l) => l.trim() && !l.includes('"rate_limit_event"'));
  let isError = false;
  const last = lines.at(-1);
  if (last) {
    try {
      isError = JSON.parse(last)?.is_error === true;
    } catch { /* plain text output */ }
  }
  if (run.code === 0 && !isError) return null;
  const text = `${run.stderr.toString('utf8')}\n${lines.join('\n')}`;
  if (LIMIT_RE.test(text)) return 'limit';
  if (AUTH_RE.test(text)) return 'auth';
  return null;
}

let current = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  try {
    process.on(sig, () => {
      try { current?.kill(); } catch { /* already gone */ }
      process.exit(130);
    });
  } catch { /* signal not supported on this platform */ }
}

async function main() {
  const args = process.argv.slice(2);
  const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
  const real = (() => { try { return realpathSync(resolve(REAL_BIN)); } catch { return resolve(REAL_BIN); } })();
  if (/^claude-acct/i.test(basename(real)) || real === self) {
    process.stderr.write('claude-acct: CLAUDE_REAL_BIN points at the shim itself; set it to the real claude.exe\n');
    return 2;
  }

  // Our own child must never come back through us, whatever its PATH says.
  const baseEnv = { ...process.env, CLAUDE_ACCT_ACTIVE: '1' };
  const input = await readStdin();

  let cfg = null;
  if (process.env.CLAUDE_ACCT_OFF !== '1' && process.env.CLAUDE_ACCT_ACTIVE !== '1') {
    try {
      const f = readEnvFile(ENV_FILE);
      if (f.JICATE_AI_URL && f.JICATE_AI_RUNNER_TOKEN) cfg = { url: f.JICATE_AI_URL, token: f.JICATE_AI_RUNNER_TOKEN };
    } catch { /* no env file: run as before */ }
  }

  const refused = [];
  const tried = new Set();
  let ownTried = false;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pick = cfg ? await askTower(cfg, refused) : { none: 'tower not configured' };
    let env;
    let label;
    if (pick.key && !tried.has(pick.label)) {
      label = pick.label;
      tried.add(label);
      env = { ...baseEnv, CLAUDE_CODE_OAUTH_TOKEN: pick.key };
    } else {
      if (ownTried) break; // the floor ran already: hand back what we have
      ownTried = true;
      label = 'own-sign-in';
      env = baseEnv; // exactly what the drain had before this shim
      if (pick.none) log(`tower: ${pick.none}`);
    }
    last = await runClaude(args, env, input);
    const why = refusalOf(last);
    log(`attempt=${attempt} account=${label} exit=${last.code}${why ? ` refused=${why}` : ''}`);
    if (!why || label === 'own-sign-in' || input === null) break;
    refused.push(label);
  }

  process.stdout.write(last.stdout);
  process.stderr.write(last.stderr);
  return last.code;
}

const isMain = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  main().then(
    (code) => { process.exitCode = code; },
    (e) => {
      log(`crashed: ${e?.message ?? e}`);
      process.stderr.write(`claude-acct: ${e?.message ?? e}\n`);
      process.exitCode = 1;
    }
  );
}
