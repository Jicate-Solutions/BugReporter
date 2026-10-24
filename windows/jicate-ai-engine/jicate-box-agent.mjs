#!/usr/bin/env node
// JICATE box account agent - applies the Control Tower's account choice to the
// WHOLE Windows box. Pure ASCII on purpose.
//
// Once a minute it asks the Control Tower which Claude account this box should
// use. When that changes it:
//   1. sets the user environment variable CLAUDE_CODE_OAUTH_TOKEN to that
//      account's key (setx), or removes it for "the box's own sign-in";
//   2. restarts every task listed in box-agent.json "restartTasks" (schtasks
//      /end then /run) so running workers start again on the new account;
//   3. reports what it applied.
// Claude tabs already open keep their account until they are reopened.
//
// Files next to this script (made at install, readable by this user only):
//   box-agent.env   JICATE_AI_URL=... and JICATE_AI_RUNNER_TOKEN=<agent token>
//   box-agent.json  { "restartTasks": [ "ai.jicate.engine-1",
//                     { "task": "ai.jicate.engine-2", "match": "jicate-ai-drain.mjs" }, ... ] }
//                   "match" (optional): also stop every process whose command
//                   line contains it. Needed for long-running workers: ending
//                   the task does not stop the node it started, and a child of
//                   an old process keeps the OLD environment (probe, win-ai
//                   2026-10-20).
//   box-agent.state the label last applied, and "+restart" while a restart
//                   is still owed (no secret)
// Restarts wait until the Control Tower says none of this box's JICATE workers
// is mid-job (up to 10 minutes, then restart anyway), so a switch never cuts a
// job short. MyJKKN's jobs are not visible to the Tower; their tasks restart
// at the same moment.
// The key itself is never written to a file or a log by this script; it lives
// in HKCU\Environment, readable by this Windows user (accepted by the Director).
//
//   node jicate-box-agent.mjs            forever loop (Task Scheduler, every minute + IgnoreNew)
//   ONESHOT=1 node jicate-box-agent.mjs  one check, then exit

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ONESHOT = process.env.ONESHOT === '1';
const EVERY_MS = 60_000;

function envValue(key) {
  try {
    for (const raw of readFileSync(resolve(HERE, 'box-agent.env'), 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/^\uFEFF/, '');
      if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* missing */ }
  return '';
}

const BASE = envValue('JICATE_AI_URL').replace(/\/+$/, '');
const TOKEN = envValue('JICATE_AI_RUNNER_TOKEN');
if (!BASE || TOKEN.length < 32) {
  console.error('[box-agent] box-agent.env is missing JICATE_AI_URL or the agent token');
  process.exit(1);
}
let config = { restartTasks: [] };
try { config = JSON.parse(readFileSync(resolve(HERE, 'box-agent.json'), 'utf8')); } catch { /* none */ }
const SAFE = /^[\w .\\-]{1,200}$/;
const RESTART = (config.restartTasks || [])
  .map((t) => (typeof t === 'string' ? { task: t } : t))
  .filter((t) => t && SAFE.test(t.task || '') && (t.match == null || (SAFE.test(t.match) && !/box-agent/i.test(t.match))));

const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), '[box-agent]', ...a);

function stateRead() {
  try { return readFileSync(resolve(HERE, 'box-agent.state'), 'utf8').trim(); } catch { return ''; }
}
function stateWrite(v) {
  writeFileSync(resolve(HERE, 'box-agent.state'), v);
}

async function call(method, path, body) {
  const r = await fetch(`${BASE}/api/internal/ai-engine/box-agent${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  if (!r.ok) throw new Error(`${r.status}: ${data?.error?.message || text.slice(0, 160)}`);
  return data;
}

function setBoxAccount(key) {
  if (key) {
    // setx stores it for this user; new processes see it. Output hidden: it echoes nothing secret,
    // but keep the console clean.
    execFileSync('setx', ['CLAUDE_CODE_OAUTH_TOKEN', key], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', 'CLAUDE_CODE_OAUTH_TOKEN', '/f'], { stdio: 'ignore', windowsHide: true });
    } catch { /* already absent */ }
  }
}

/** Stop every process (not this agent) whose command line contains `match`. */
function stopMatching(match) {
  const ps = [
    "$m = $env:JM_MATCH",
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m) -and $_.ProcessId -ne $PID -and $_.ProcessId -ne [int]$env:JM_SELF } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'ignore', windowsHide: true, env: { ...process.env, JM_MATCH: match, JM_SELF: String(process.pid) },
  });
}

function restartTasks() {
  const done = [];
  // Stop everything first, then start everything: two workers share one command
  // line, so stopping the second's match after starting the first killed the first.
  for (const { task } of RESTART) {
    try { execFileSync('schtasks', ['/end', '/tn', task], { stdio: 'ignore', windowsHide: true }); } catch { /* not running */ }
  }
  for (const match of new Set(RESTART.map((t) => t.match).filter(Boolean))) {
    try { stopMatching(match); } catch (e) { log(`could not stop "${match}": ${String(e?.message || e).slice(0, 120)}`); }
  }
  for (const { task } of RESTART) {
    try {
      execFileSync('schtasks', ['/run', '/tn', task], { stdio: 'ignore', windowsHide: true });
      done.push(task);
    } catch (e) {
      log(`could not restart ${task}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return done;
}

const MAX_WAIT_CHECKS = 10; // minutes to wait for idle workers before restarting anyway
let waited = 0;

async function checkOnce() {
  const raw = stateRead() || 'default';
  const owed = raw.endsWith('+restart');
  const have = owed ? raw.slice(0, -'+restart'.length) : raw;
  const d = await call('GET', `?have=${encodeURIComponent(have)}`);
  const want = d.label || 'default';
  if (want !== have) {
    if (want !== 'default' && !d.key) throw new Error(`server chose ${want} but sent no key`);
    setBoxAccount(want === 'default' ? '' : d.key);
    stateWrite(`${want}+restart`);
    log(`box account set ${have} -> ${want}; restarting workers when idle`);
  } else if (!owed) {
    return;
  }
  if ((d.busy ?? 0) > 0 && waited < MAX_WAIT_CHECKS) {
    waited += 1;
    log(`waiting: ${d.busy} job(s) running on this box (${waited}/${MAX_WAIT_CHECKS})`);
    return;
  }
  waited = 0;
  const restarted = restartTasks();
  stateWrite(want);
  log(`box switched to ${want}; restarted ${restarted.length} task(s): ${restarted.join(', ') || 'none'}`);
  await call('POST', '', { applied: want === 'default' ? null : want, restarted });
}

async function main() {
  log(`start host-agent url=${BASE} restartTasks=${RESTART.length}`);
  let fails = 0;
  for (;;) {
    try {
      await checkOnce();
      fails = 0;
    } catch (e) {
      fails += 1;
      if (fails === 1 || fails % 30 === 0) log(`check failed (${fails}): ${String(e?.message || e).slice(0, 200)}`);
    }
    if (ONESHOT) break;
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

main().catch((e) => {
  console.error(ts(), '[box-agent] fatal:', String(e?.message || e));
  process.exit(1);
});
