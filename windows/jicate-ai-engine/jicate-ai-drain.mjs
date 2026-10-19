// ============================================================================
// JICATE AI engine — drain (JICATE Windows AI box)
// ----------------------------------------------------------------------------
// Takes ONE job at a time from the JICATE Control Tower (the central bug
// reporter), runs the finished prompt it is given through the Max-seat Claude
// CLI (headless `claude -p`, ₹0), and hands the answer back. The recipe and the
// prompt are built by the server; this file never needs to change when a task
// is added or reworded.
//
// WHY THIS IS NOT THE MyJKKN DRAIN: Director, 2026-10-19 — JICATE AI work runs
// on JICATE's own engine, not in MyJKKN's database or queue. This drain talks
// only to two Control Tower routes.
//
// LEAST PRIVILEGE: this box holds NO database key. It holds one bearer token
// that opens exactly two routes:
//   POST {JICATE_AI_URL}/api/internal/ai-engine/claim     -> { job } | { job: null }
//   POST {JICATE_AI_URL}/api/internal/ai-engine/complete  -> { status }
// If the token leaks, the holder can take queued AI jobs and answer them. It
// cannot read any table, any bug, or anything in MyJKKN.
//
// LESSONS CARRIED OVER FROM THE MyJKKN MAX LANE
// - The claim reply is an envelope; the server unwraps {job, spec} and sends a
//   ready job. `job: null` means idle — never misread as an error.
// - Person-waiting (interactive) jobs are ordered first by the server; this
//   drain polls every IDLE_MS (default 3 s) so a reply lands well inside 60 s.
// - Per-job credential file: NOT NEEDED here. Jobs run with no tools, so no
//   user token is ever written to disk. If a tool-using task is ever added,
//   give each job its own randomly named credential file, deleted in a finally.
// - Timeouts kill with SIGKILL (a polite signal can leave claude.exe alive).
// - Every run is reported to /complete, success or failure, so the usage
//   ledger (ai_usage) has a row for every run and the Models page shows ₹0.
// - Always-on = Task Scheduler TimeTrigger every minute + IgnoreNew, never
//   AtLogOn alone. Prove it by killing the process, not by reading the task.
//
// ENV (from ENV_FILE, default engine.env next to this script — exactly two lines):
//   JICATE_AI_URL=https://jkkn-centralized-bug-reporter.vercel.app
//   JICATE_AI_RUNNER_TOKEN=<typed in by the Director; never written in a doc>
// Optional process env (set by run-jicate-ai-drain.cmd): SANDBOX, IDLE_MS,
//   RUNNER, CLAUDE_BIN, ONESHOT=1.
//
// USAGE
//   ONESHOT=1 node jicate-ai-drain.mjs   # take at most one job, then exit
//   node jicate-ai-drain.mjs             # forever loop (Task Scheduler)
// ============================================================================

import { execFile } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.ENV_FILE || resolve(HERE, 'engine.env');

/**
 * Read one key from a dotenv file. Strips whitespace, surrounding quotes and a
 * trailing LITERAL "\n" — values pasted from other tools have arrived that way
 * before and produce a token that silently never matches.
 */
function fromEnvFile(key) {
  try {
    for (const raw of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/^﻿/, '');
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
const RUNNER     = process.env.RUNNER || 'jicate-1';
const ONESHOT    = process.env.ONESHOT === '1';
const IDLE_MS    = Number(process.env.IDLE_MS || 3000);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// OUTSIDE any repo: `claude -p` walks up from its cwd and loads any CLAUDE.md
// or .claude settings it finds.
const SANDBOX    = process.env.SANDBOX || join(tmpdir(), 'jicate-ai-sandbox');
const RATE_LIMIT_PAUSE_MS = 60_000;

if (!BASE || !TOKEN) {
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
  constructor(message, { retry = false, rateLimited = false } = {}) {
    super(message);
    this.retry = retry;
    this.rateLimited = rateLimited;
  }
}

const RATE_LIMIT_RE = /rate.?limit|usage limit|too many requests|\b429\b|overloaded/i;

/**
 * One headless Claude call on the Max seat. No tools, no MCP, no hooks, no
 * skills, no transcript on disk. Returns { answer, usage }.
 */
function runClaude(job) {
  mkdirSync(SANDBOX, { recursive: true });
  const args = [
    '-p', '--model', job.model, '--output-format', 'json',
    '--restricted',              // ignore project/local settings and hooks
    '--strict-mcp-config',       // no MCP servers
    '--no-session-persistence',  // no transcript on disk
    '--disable-slash-commands',  // no skills
    '--allowedTools', '',        // pure text: no files, no shell, no network
  ];
  const timeout = Math.max(10_000, Number(job.timeout_ms) || 120_000);
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      CLAUDE_BIN, args,
      { cwd: SANDBOX, timeout, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          return reject(new RunError(`timed out after ${timeout} ms`, { retry: true }));
        }
        let d = null;
        try { d = JSON.parse(stdout); } catch { /* handled below */ }
        if (!d) {
          const msg = String(stderr || err?.message || stdout || 'no output').slice(0, 300);
          return reject(new RunError(`claude failed: ${msg}`, {
            retry: true, rateLimited: RATE_LIMIT_RE.test(msg),
          }));
        }
        const usage = {
          model_id: Object.keys(d.modelUsage || {})[0] || job.model,
          input_tokens: Number.isFinite(d.usage?.input_tokens) ? d.usage.input_tokens : null,
          output_tokens: Number.isFinite(d.usage?.output_tokens) ? d.usage.output_tokens : null,
        };
        if (d.is_error) {
          const msg = String(d.result ?? d.subtype ?? 'error').slice(0, 300);
          const limited = RATE_LIMIT_RE.test(msg);
          return reject(Object.assign(
            new RunError(`claude error: ${msg}`, { retry: true, rateLimited: limited }),
            { usage },
          ));
        }
        resolvePromise({ answer: String(d.result ?? '').trim(), usage });
      },
    );
    child.stdin.end(job.prompt);
  });
}

async function drainOnce() {
  const { job } = await post('/api/internal/ai-engine/claim', { runner: RUNNER });
  if (!job) return { worked: false };

  // Log ids only — never the payload or the answer.
  log(`claimed ${job.job_id} ${job.job_type} attempt=${job.attempts} model=${job.model}`);
  const started = Date.now();
  try {
    const { answer, usage } = await runClaude(job);
    if (!answer) throw new RunError('claude returned empty output', { retry: true });
    const done = await post('/api/internal/ai-engine/complete', {
      job_id: job.job_id, runner: RUNNER, answer,
      usage: { ...usage, duration_ms: Date.now() - started },
    });
    log(`DONE ${job.job_id} status=${done?.status} in ${Date.now() - started}ms`);
    return { worked: true };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 900);
    logErr(`FAIL ${job.job_id}: ${msg}${e?.rateLimited ? ' RATE-LIMITED' : ''}`);
    // Report it so the ledger records the failed run and the job is retried
    // (the server gives up after 3 attempts).
    await post('/api/internal/ai-engine/complete', {
      job_id: job.job_id, runner: RUNNER, error: msg, retry: e?.retry !== false,
      usage: { ...(e?.usage || {}), duration_ms: Date.now() - started },
    }).catch((e2) => logErr(`release failed: ${String(e2?.message || e2).slice(0, 200)}`));
    return { worked: true, rateLimited: Boolean(e?.rateLimited) };
  }
}

async function main() {
  log(`start runner=${RUNNER} url=${BASE} idle=${IDLE_MS}ms oneshot=${ONESHOT} bin=${CLAUDE_BIN}`);
  for (;;) {
    let outcome = { worked: false };
    try {
      outcome = await drainOnce();
    } catch (e) {
      logErr(`claim error: ${String(e?.message || e).slice(0, 300)}`);
      // 401/503 = wrong or missing token: slow down instead of hammering.
      if (e?.status === 401 || e?.status === 503) await new Promise((r) => setTimeout(r, 60_000));
    }
    if (ONESHOT) break;
    if (outcome.rateLimited) {
      log(`pausing ${RATE_LIMIT_PAUSE_MS / 1000}s after a rate limit`);
      await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS));
    } else if (!outcome.worked) {
      await new Promise((r) => setTimeout(r, IDLE_MS));
    }
  }
}

main().catch((e) => {
  logErr(`fatal: ${String(e?.message || e)}`);
  process.exit(1);
});
