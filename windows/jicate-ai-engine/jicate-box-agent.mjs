#!/usr/bin/env node
// JICATE box account agent - applies the Control Tower's account choice to the
// WHOLE Windows box, and installs worker-file updates published there.
// Pure ASCII on purpose.
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
// FILE UPDATES (2026-10-24). The workers on a box may run as S4U tasks that a
// Claude tab cannot restart without Windows admin; this agent runs as the same
// user and already restarts them, so it also installs new worker files:
//   - only names in FILES (the JICATE worker). This agent NEVER updates itself.
//   - only when box-agent.json has "updatePublicKey" (Ed25519, PEM or base64
//     SPKI DER). The file's signature must verify with it, and its sha256 must
//     equal the sha the Tower lists AND the sha of the bytes received, so a
//     database write alone cannot run code on this box.
//   - a missing local file is never created (skipped, logged once).
//   - staged as <name without .mjs>.new.mjs, then `node --check`; waits for idle
//     workers (own wait counter); keeps <name>.bak-<old sha8>; swaps; restarts
//     ONLY the JICATE worker tasks (restartTasks entries whose "match" names the
//     file, or task ai.jicate.engine-*), never MyJKKN helpers on the same list.
//   - health check: every worker of this box seen in the 5 minutes before the
//     swap must check in again within 3 minutes after it (if none was active,
//     at least one must), else the backup is restored, the worker tasks
//     restarted again and that sha is never tried again. The swap is recorded
//     before the rename, so an agent that stops mid-swap finishes it next run.
//   - only after the health check passes does it report the sha it runs.
//   Any failure keeps the old file and is logged once.
//
// Files next to this script (made at install, readable by this user only):
//   box-agent.env   JICATE_AI_URL=... and JICATE_AI_RUNNER_TOKEN=<agent token>
//   box-agent.json  { "restartTasks": [ "ai.jicate.engine-1",
//                     { "task": "ai.jicate.engine-2", "match": "jicate-ai-drain.mjs" }, ... ],
//                     "updatePublicKey": "<optional, see FILE UPDATES>" }
//                   "match" (optional): also stop every process whose command
//                   line contains it. Needed for long-running workers: ending
//                   the task does not stop the node it started, and a child of
//                   an old process keeps the OLD environment (probe, win-ai
//                   2026-10-20).
//   box-agent.state the label last applied, and "+restart" while a restart
//                   is still owed (no secret)
//   box-agent.files.json  file-update memory: shas that failed, and a swap
//                   still waiting for its health check (no secret)
// Restarts wait until the Control Tower says none of this box's JICATE workers
// is mid-job (up to 10 minutes, then restart anyway), so a switch never cuts a
// job short. MyJKKN's jobs are not visible to the Tower; their tasks restart
// at the same moment.
// The key itself is never written to a file or a log by this script; it lives
// in HKCU\Environment, readable by this Windows user (accepted by the Director).
//
//   node jicate-box-agent.mjs            forever loop (Task Scheduler, every minute + IgnoreNew)
//   ONESHOT=1 node jicate-box-agent.mjs  one check, then exit

import { readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

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
const said = new Set();
/** Log a line only the first time this key is seen (per agent run). */
const once = (key, msg) => { if (!said.has(key)) { said.add(key); log(msg); } };

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

/** Restart the listed tasks; `only` (optional) narrows the list. */
function restartTasks(only) {
  const list = only ? RESTART.filter(only) : RESTART;
  const done = [];
  // Stop everything first, then start everything: two workers share one command
  // line, so stopping the second's match after starting the first killed the first.
  for (const { task } of list) {
    try { execFileSync('schtasks', ['/end', '/tn', task], { stdio: 'ignore', windowsHide: true }); } catch { /* not running */ }
  }
  for (const match of new Set(list.map((t) => t.match).filter(Boolean))) {
    try { stopMatching(match); } catch (e) { log(`could not stop "${match}": ${String(e?.message || e).slice(0, 120)}`); }
  }
  for (const { task } of list) {
    try {
      execFileSync('schtasks', ['/run', '/tn', task], { stdio: 'ignore', windowsHide: true });
      done.push(task);
    } catch (e) {
      log(`could not restart ${task}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return done;
}

// ---- file updates --------------------------------------------------------

const FILES = ['jicate-ai-drain.mjs']; // the worker only; never this agent
const HEX64 = /^[0-9a-f]{64}$/;
const HEALTH_MS = 3 * 60_000; // workers must check in again within this after a swap
const LIVE_MS = 5 * 60_000; // a worker seen this recently before a swap must come back

function loadUpdateKey(v) {
  if (!v) return null;
  try {
    const s = String(v).trim();
    const k = s.includes('BEGIN')
      ? createPublicKey(s)
      : createPublicKey({ key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
    if (k.asymmetricKeyType !== 'ed25519') throw new Error(`key type ${k.asymmetricKeyType}, want ed25519`);
    return k;
  } catch (e) {
    log(`updatePublicKey in box-agent.json is not usable (${String(e?.message || e).slice(0, 120)}); file updates are off`);
    return null;
  }
}
const UPDATE_KEY = loadUpdateKey(config.updatePublicKey);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
function shaOfFile(path) {
  try { return sha256(readFileSync(path)); } catch { return null; }
}
const stageName = (name) => name.replace(/\.mjs$/, '.new.mjs'); // .mjs so `node --check` parses it as ESM
const short = (sha) => String(sha || '').slice(0, 8);

const FSTATE = resolve(HERE, 'box-agent.files.json');
function filesRead() {
  try {
    const s = JSON.parse(readFileSync(FSTATE, 'utf8'));
    return { failed: Array.isArray(s.failed) ? s.failed : [], pending: s.pending || null };
  } catch { return { failed: [], pending: null }; }
}
const fstate = filesRead();
function filesWrite() {
  fstate.failed = fstate.failed.slice(-50);
  writeFileSync(FSTATE, JSON.stringify(fstate));
}
function markFailed(tag) {
  if (!fstate.failed.includes(tag)) fstate.failed.push(tag);
  filesWrite();
}
const staged = {}; // name -> sha already downloaded, verified and checked as <stage>
const retryAfter = {}; // tag -> local time; a failed download is tried again after 30 min

/** The shas this box runs, for reports. Omitted while a swap awaits its health check. */
function filesReport() {
  if (fstate.pending) return undefined;
  const out = {};
  for (const name of FILES) {
    const sha = shaOfFile(resolve(HERE, name));
    if (sha) out[name] = sha;
  }
  return Object.keys(out).length ? out : undefined;
}

function appliedLabel() {
  const l = stateRead() || 'default';
  return l === 'default' ? null : l;
}

/** Server time now, from the last GET (falls back to this box's clock). */
function serverNow(d, gotAt) {
  const t = Date.parse(d?.now || '');
  return Number.isFinite(t) ? t + (Date.now() - gotAt) : Date.now();
}

/**
 * A file update restarts only the JICATE worker tasks: entries whose "match"
 * names the updated file, or whose task is ai.jicate.engine-*. Other tasks in
 * restartTasks (e.g. MyJKKN helpers, whose jobs `busy` does not count) are left
 * alone. Account switches still restart the whole list.
 */
const workerTasks = (name) => (t) => (t.match != null && t.match.includes(name)) || /^ai\.jicate\.engine-/i.test(t.task);

async function healthCheck(d, gotAt) {
  const p = fstate.pending;
  if (shaOfFile(resolve(HERE, p.name)) !== p.to) {
    // The agent stopped before the rename: the old file still runs, nothing to check.
    fstate.pending = null;
    filesWrite();
    log(`file ${p.name} ${short(p.to)}: swap did not complete; still on ${short(p.from)}`);
    return;
  }
  if (p.restarting) {
    // The agent stopped mid-restart: restart the workers again, then check them.
    const restarted = restartTasks(workerTasks(p.name));
    p.at = new Date(serverNow(d, gotAt)).toISOString();
    p.restarting = false;
    filesWrite();
    log(`file ${p.name} ${short(p.to)}: restart was interrupted; restarted ${restarted.length} worker task(s) again`);
    return;
  }
  const now = serverNow(d, gotAt);
  const at = Date.parse(p.at);
  const seenAfter = (w) => Date.parse(w.last_seen_at || '') > at;
  let healthy;
  let why;
  if ((p.workers || []).length) {
    const back = new Set((d.workers || []).filter(seenAfter).map((w) => w.name));
    const missing = p.workers.filter((n) => !back.has(n));
    healthy = missing.length === 0;
    why = `not back: ${missing.join(', ')}`;
  } else {
    // No worker was active before the swap: at least one must check in after it.
    healthy = (d.workers || []).some(seenAfter);
    why = 'no worker of this box checked in';
  }
  if (healthy) {
    await call('POST', '', { applied: appliedLabel(), files: { [p.name]: p.to } });
    fstate.pending = null;
    filesWrite();
    log(`file ${p.name} ${short(p.to)} healthy: ${(p.workers || []).length || 'any'} worker(s) back after the swap`);
    return;
  }
  if (now - at < HEALTH_MS) return; // still inside the window; check again next minute
  copyFileSync(resolve(HERE, p.backup), resolve(HERE, p.name));
  const restarted = restartTasks(workerTasks(p.name));
  fstate.pending = null;
  markFailed(`${p.name}:${p.to}`);
  log(`file ${p.name} ${short(p.to)} failed health check (${why}); restored ${short(p.from)} and restarted ${restarted.length} task(s)`);
}

async function updateFile(d, gotAt, f, cur) {
  const path = resolve(HERE, f.name);
  const stage = resolve(HERE, stageName(f.name));
  const tag = `${f.name}:${f.sha256}`;
  if (staged[f.name] !== f.sha256 || shaOfFile(stage) !== f.sha256) {
    staged[f.name] = null;
    let got;
    try {
      got = await call('GET', `?file=${encodeURIComponent(f.name)}`);
    } catch (e) {
      retryAfter[tag] = Date.now() + 30 * 60_000;
      log(`file ${f.name} ${short(f.sha256)} download failed (${String(e?.message || e).slice(0, 120)}); trying again in 30 min`);
      return;
    }
    try {
      if (!got || typeof got.content !== 'string') throw new Error('reply has no content');
      const bytes = Buffer.from(got.content, 'utf8');
      const sha = sha256(bytes);
      if (sha !== f.sha256 || got.sha256 !== f.sha256) throw new Error(`sha mismatch (bytes ${short(sha)}, reply ${short(got.sha256)})`);
      const sig = Buffer.from(String(got.signature || ''), 'base64');
      if (sig.length !== 64 || !verifySignature(null, bytes, UPDATE_KEY, sig)) throw new Error('signature does not verify');
      writeFileSync(stage, bytes);
      try {
        execFileSync(process.execPath, ['--check', stage], { stdio: 'ignore', windowsHide: true });
      } catch {
        throw new Error('node --check failed');
      }
      staged[f.name] = f.sha256;
      log(`file ${f.name} ${short(cur)} -> ${short(f.sha256)} staged; swapping when workers are idle`);
    } catch (e) {
      try { unlinkSync(stage); } catch { /* none */ }
      markFailed(tag);
      log(`file ${f.name} ${short(f.sha256)} rejected (${String(e?.message || e).slice(0, 160)}); keeping ${short(cur)}`);
      return;
    }
  }
  if ((d.busy ?? 0) > 0 && fileWaited < MAX_WAIT_CHECKS) {
    fileWaited += 1;
    log(`waiting: ${d.busy} job(s) running on this box (${fileWaited}/${MAX_WAIT_CHECKS}) before file update`);
    return;
  }
  fileWaited = 0;
  const backup = `${f.name}.bak-${short(cur)}`;
  const only = workerTasks(f.name);
  const before = serverNow(d, gotAt);
  const live = (d.workers || [])
    .filter((w) => before - Date.parse(w.last_seen_at || '') < LIVE_MS)
    .map((w) => w.name);
  let swapped = false;
  try {
    copyFileSync(path, resolve(HERE, backup));
    // Recorded BEFORE the swap: if the agent stops anywhere after this, the next
    // run finishes the restart and the health check instead of trusting the file.
    fstate.pending = { name: f.name, from: cur, to: f.sha256, backup, at: null, workers: live, restarting: true };
    filesWrite();
    renameSync(stage, path);
    swapped = true;
    staged[f.name] = null;
    const restarted = restartTasks(only);
    // Mark the time AFTER the old processes are stopped, so only a new process can pass.
    fstate.pending.at = new Date(serverNow(d, gotAt)).toISOString();
    fstate.pending.restarting = false;
    filesWrite();
    log(`file updated ${f.name} ${short(cur)} -> ${short(f.sha256)}; restarted ${restarted.length} task(s)`);
  } catch (e) {
    if (swapped) {
      try { copyFileSync(resolve(HERE, backup), path); } catch { /* reported below */ }
      restartTasks(only);
    }
    try { unlinkSync(stage); } catch { /* none */ }
    staged[f.name] = null;
    fstate.pending = null;
    try { filesWrite(); } catch { /* reported below */ }
    // Before the swap (file busy, antivirus ...): try again later. After it: never again.
    if (swapped) markFailed(tag);
    else retryAfter[tag] = Date.now() + 30 * 60_000;
    log(`file ${f.name} ${short(f.sha256)} swap failed (${String(e?.message || e).slice(0, 160)}); ${swapped ? 'restored' : 'kept'} ${short(cur)}${swapped ? '' : '; trying again in 30 min'}`);
  }
}

async function applyFiles(d, gotAt) {
  if (fstate.pending) return healthCheck(d, gotAt);
  const wanted = (d.files || []).filter((f) => f && FILES.includes(f.name) && HEX64.test(f.sha256 || ''));
  if (wanted.length && !UPDATE_KEY) {
    once('nokey', 'file updates are published but box-agent.json has no usable updatePublicKey; not applying them');
    return;
  }
  for (const f of wanted) {
    const cur = shaOfFile(resolve(HERE, f.name));
    if (!cur) { once(`missing:${f.name}`, `${f.name} is not on this box; not creating it`); continue; }
    if (cur === f.sha256) continue;
    const tag = `${f.name}:${f.sha256}`;
    if (fstate.failed.includes(tag)) { once(`failed:${tag}`, `file ${f.name} ${short(f.sha256)} failed before; not trying it again`); continue; }
    if ((retryAfter[tag] ?? 0) > Date.now()) continue;
    await updateFile(d, gotAt, f, cur);
    return; // one file per check
  }
}

// ---- main loop ---------------------------------------------------------------

const MAX_WAIT_CHECKS = 10; // minutes to wait for idle workers before restarting anyway
let waited = 0; // account switches
let fileWaited = 0; // file updates (own counter)

/** The account switch. True when nothing is owed (the file step may run). */
async function applyAccount(d, have, owed) {
  const want = d.label || 'default';
  if (want !== have) {
    if (want !== 'default' && !d.key) throw new Error(`server chose ${want} but sent no key`);
    setBoxAccount(want === 'default' ? '' : d.key);
    stateWrite(`${want}+restart`);
    log(`box account set ${have} -> ${want}; restarting workers when idle`);
  } else if (!owed) {
    return true;
  }
  if ((d.busy ?? 0) > 0 && waited < MAX_WAIT_CHECKS) {
    waited += 1;
    log(`waiting: ${d.busy} job(s) running on this box (${waited}/${MAX_WAIT_CHECKS})`);
    return false;
  }
  waited = 0;
  const restarted = restartTasks();
  stateWrite(want);
  log(`box switched to ${want}; restarted ${restarted.length} task(s): ${restarted.join(', ') || 'none'}`);
  const files = filesReport();
  await call('POST', '', { applied: want === 'default' ? null : want, restarted, ...(files ? { files } : {}) });
  return false;
}

async function checkOnce() {
  const raw = stateRead() || 'default';
  const owed = raw.endsWith('+restart');
  const have = owed ? raw.slice(0, -'+restart'.length) : raw;
  const d = await call('GET', `?have=${encodeURIComponent(have)}`);
  const gotAt = Date.now();
  if (!(await applyAccount(d, have, owed))) return;
  try {
    await applyFiles(d, gotAt);
  } catch (e) {
    once(`files:${String(e?.message || e).slice(0, 80)}`, `file update step failed: ${String(e?.message || e).slice(0, 200)}`);
  }
}

async function main() {
  log(`start host-agent url=${BASE} restartTasks=${RESTART.length} fileUpdates=${UPDATE_KEY ? 'on' : 'off'}`);
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
