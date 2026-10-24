#!/usr/bin/env node
// JICATE box account agent - applies the Control Tower's account choice to the
// WHOLE Windows box, installs files published there, runs signed commands and
// reports the box's status. Pure ASCII on purpose.
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
// FILE UPDATES (2026-10-24). Only names in BOX_FILES, only when box-agent.json
// has "updatePublicKey" (Ed25519, PEM or base64 SPKI DER). Every file's
// signature must verify with it, and its sha256 must equal the sha the Tower
// lists AND the sha of the bytes received, so a database write alone cannot
// run code on this box. What happens next depends on the name:
//   - jicate-ai-drain.mjs (the JICATE worker), and run-jicate-ai-drain.cmd:
//     a missing local file is never created. Staged (.new.mjs + `node --check`
//     for the worker, .new for the launcher); waits for idle workers (own wait
//     counter); keeps <name>.bak-<old sha8>; swaps; restarts ONLY the JICATE
//     worker tasks (restartTasks entries whose "match" names the file, or task
//     ai.jicate.engine-*), never MyJKKN helpers on the same list. Health check:
//     every worker of this box seen in the 5 minutes before the swap must
//     check in again within 3 minutes after it (if none was active, at least
//     one must), else the backup is restored, the worker tasks restarted again
//     and that sha is never tried again. The swap is recorded before the
//     rename, so an agent that stops mid-swap finishes it next run.
//     run-jicate-ai-drain.cmd must have CRLF line endings throughout.
//   - jicate-box-agent.mjs: this agent NEVER overwrites its own live file. It
//     writes jicate-box-agent.mjs.new (after `node --check` on a staged copy)
//     and then exits when idle; run-jicate-box-agent.cmd installs it on its
//     next start (and rolls it back if it never reaches the Tower).
//   - run-jicate-box-agent.cmd (the launcher): install-by-hand only. A bad
//     launcher would stop the agent every minute with no way back, so the
//     agent skips it with a log line even though the Tower may list it.
//   - jicate-mail.mjs: installed at box-agent.json "mailClientPath" (skipped
//     with a log line if that is not set), after `node --check`.
//   - ai.jicate.*.xml: installed into this folder (used by register-task).
//   A launcher (.cmd) keeps this box's paths: each `set "X=__Y__"` line takes
//   the value the live file has (__NODE_EXE__ falls back to this node).
//   Any failure keeps the old file and is logged once. Reports carry the sha
//   of what is actually on disk.
//
// COMMANDS (2026-10-24). The GET reply lists up to 5 queued commands. The
// ONLY thing trusted is the signed payload (JSON {id, box, verb, args,
// expires_at}, Ed25519 over its exact UTF-8 bytes, same updatePublicKey).
// Refused when: bad signature, payload id != row id, box != this box,
// expired, expiring more than 6 h ahead, unknown verb, or the id is already
// in the local ledger (replay). Verbs: status, restart-task (restartTasks
// names only, never this agent's task), register-task (an allow-listed xml
// this agent installed, sha still matching), run-script (powershell or cmd,
// hidden, <= 600 s, last 4 KB of output). restart-task waits for idle JICATE
// workers like the account switch (up to 10 polls) unless args.force is true;
// register-task never touches the agent's own task. Commands run in the background
// after the account and file steps, each with its own timeout, so a slow one
// never holds up the minute loop. Every 5 minutes it also posts a status
// report (secrets scrubbed).
//
// Files next to this script (made at install, readable by this user only):
//   box-agent.env   JICATE_AI_URL=... and JICATE_AI_RUNNER_TOKEN=<agent token>
//   box-agent.json  { "restartTasks": [ "ai.jicate.engine-1",
//                     { "task": "ai.jicate.engine-2", "match": "jicate-ai-drain.mjs" }, ... ],
//                     "updatePublicKey": "<optional, see FILE UPDATES>",
//                     "mailClientPath": "<optional, full path of jicate-mail.mjs>",
//                     "costLog": "<optional, log file(s) with api_cost_usd=...>",
//                     "box": "<optional, this box's name if not its hostname>",
//                     "agentTask": "<optional, default ai.jicate.box-agent>" }
//                   "match" (optional): also stop every process whose command
//                   line contains it. Needed for long-running workers: ending
//                   the task does not stop the node it started, and a child of
//                   an old process keeps the OLD environment (probe, win-ai
//                   2026-10-20).
//   box-agent.state the label last applied, and "+restart" while a restart
//                   is still owed (no secret)
//   box-agent.files.json  file-update memory: shas that failed, a swap still
//                   waiting for its health check, what each installed file
//                   was published as (no secret)
//   box-agent.commands.json  command ledger (ids handled, unsent results) and
//                   the time of the last status report (no secret)
// Restarts wait until the Control Tower says none of this box's JICATE workers
// is mid-job (up to 10 minutes, then restart anyway), so a switch never cuts a
// job short. MyJKKN's jobs are not visible to the Tower; their tasks restart
// at the same moment.
// The key itself is never written to a file or a log by this script; it lives
// in HKCU\Environment, readable by this Windows user (accepted by the Director).
//
//   node jicate-box-agent.mjs            forever loop (Task Scheduler, every minute + IgnoreNew)
//   ONESHOT=1 node jicate-box-agent.mjs  one check, then exit (waits for its commands)
//   JICATE_BOX_AGENT_NO_MAIN=1           import only (tests); nothing runs

import {
  readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, existsSync, mkdirSync,
  statSync, openSync, readSync, closeSync, statfsSync,
} from 'node:fs';
import { dirname, resolve, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { createHash, createPublicKey, verify as verifySignature, randomUUID } from 'node:crypto';
import { hostname, uptime } from 'node:os';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const ONESHOT = process.env.ONESHOT === '1';
const EVERY_MS = 60_000;

// ---- pure helpers (exported for tests) ------------------------------------

/** Files the Tower may publish. Keep in step with ai_box_files' CHECK. */
export const BOX_FILES = [
  'jicate-ai-drain.mjs', 'jicate-box-agent.mjs', 'jicate-mail.mjs',
  'run-jicate-ai-drain.cmd', 'run-jicate-box-agent.cmd',
  'ai.jicate.engine-1.xml', 'ai.jicate.engine-2.xml', 'ai.jicate.engine-3.xml', 'ai.jicate.engine-4.xml',
  'ai.jicate.box-agent.xml',
];
export const XML_FILES = BOX_FILES.filter((n) => n.endsWith('.xml'));
export const VERBS = ['status', 'restart-task', 'register-task', 'run-script'];
export const MAX_EXPIRY_MS = 6 * 60 * 60_000;
const CLOCK_SLACK_MS = 2 * 60_000; // the Mac signs a moment before the row lands
export const SAFE = /^[\w .\\-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const short = (sha) => String(sha || '').slice(0, 8);
/** .mjs so `node --check` parses it as ESM. */
const stageName = (name) => name.replace(/\.mjs$/, '.new.mjs');

/** restartTasks from box-agent.json, normalised; never anything matching the agent. */
export function normalizeRestart(cfg) {
  return ((cfg && cfg.restartTasks) || [])
    .map((t) => (typeof t === 'string' ? { task: t } : t))
    .filter((t) => t && SAFE.test(t.task || '') && (t.match == null || (SAFE.test(t.match) && !/box-agent/i.test(t.match))));
}

/** The Ed25519 key in box-agent.json "updatePublicKey" (PEM or base64 SPKI DER). Throws if unusable. */
export function parseUpdateKey(v) {
  const s = String(v).trim();
  const k = s.includes('BEGIN')
    ? createPublicKey(s)
    : createPublicKey({ key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
  if (k.asymmetricKeyType !== 'ed25519') throw new Error(`key type ${k.asymmetricKeyType}, want ed25519`);
  return k;
}

/**
 * Checks one queued command from the Tower. Only the signed payload counts;
 * the row is an index. The signature is checked over the row's payload string
 * exactly as received, before it is parsed; it is never re-serialized.
 * `nowMs` is the Tower's clock (serverNow), not this box's. `ledger` holds the
 * ids this box already handled.
 */
export function verifyCommand(row, { key, box, nowMs, ledger = {} }) {
  const no = (reason) => ({ ok: false, reason });
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !UUID.test(row.id)) return no('malformed command row');
  if (!key) return no('this box has no usable updatePublicKey; commands are off');
  if (typeof row.payload !== 'string' || row.payload.length === 0 || row.payload.length > 512 * 1024) return no('payload missing or too large');
  const sig = Buffer.from(String(row.signature || ''), 'base64');
  let good = false;
  try {
    good = sig.length === 64 && verifySignature(null, Buffer.from(row.payload, 'utf8'), key, sig);
  } catch { good = false; }
  if (!good) return no('signature does not verify');
  let p;
  try { p = JSON.parse(row.payload); } catch { return no('payload is not JSON'); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return no('payload is not an object');
  if (p.id !== row.id) return no('payload id does not match the command row');
  if (typeof p.box !== 'string' || p.box.toLowerCase() !== String(box || '').toLowerCase()) {
    return no(`payload is for box "${String(p.box).slice(0, 60)}", not this box`);
  }
  const exp = typeof p.expires_at === 'string' ? Date.parse(p.expires_at) : NaN;
  if (!Number.isFinite(exp)) return no('payload has no valid expires_at');
  if (exp <= nowMs) return no('expired');
  if (exp - nowMs > MAX_EXPIRY_MS + CLOCK_SLACK_MS) return no('expires more than 6 hours ahead');
  if (!VERBS.includes(p.verb)) return no(`unknown verb "${String(p.verb).slice(0, 40)}"`);
  if (row.verb !== undefined && row.verb !== p.verb) return no('row verb does not match the signed verb');
  if (p.args != null && (typeof p.args !== 'object' || Array.isArray(p.args))) return no('args must be an object');
  if (Object.prototype.hasOwnProperty.call(ledger, row.id)) return no('replay: this command id was already handled on this box');
  return { ok: true, payload: { id: p.id, box: p.box, verb: p.verb, args: p.args || {}, expires_at: p.expires_at, exp } };
}

/**
 * Which restartTasks entries a restart-task command restarts. Tasks that share
 * a "match" with the named task go too: stopping the match stops their
 * processes as well, so they must be started again.
 */
export function restartSelection(restart, task, agentTask = 'ai.jicate.box-agent') {
  if (typeof task !== 'string' || !SAFE.test(task)) return { error: 'task name missing or not allowed' };
  if (/box-agent/i.test(task) || task.toLowerCase() === String(agentTask).toLowerCase()) {
    return { error: 'the box agent never restarts its own task' };
  }
  const named = restart.filter((t) => t.task === task);
  if (!named.length) return { error: `${task} is not in box-agent.json restartTasks` };
  const matches = new Set(named.map((t) => t.match).filter(Boolean));
  return { list: restart.filter((t) => t.task === task || (t.match && matches.has(t.match))) };
}

const SECRET_KEY = /token|secret|passw|pwd|key|credential|auth|cookie/i;

/** Redacts secret-looking text: key=value pairs, bearer tokens, long base64/hex runs. */
export function scrubText(s) {
  return String(s ?? '')
    .replace(/\b(bearer)\s+[^\s"']+/gi, '$1 [redacted]')
    .replace(/\bsk-ant-[\w-]+/g, '[redacted]')
    .replace(/([\w-]*(?:token|secret|passw|pwd|api[_-]?key|private[_-]?key|credential)[\w-]*"?\s*[=:]\s*"?)[^\s"',;&]+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (m) => (UUID.test(m) || (!/\d/.test(m) && m.length < 48) ? m : '[redacted]'));
}

/** box-agent.json for a report: secret-looking keys removed, strings scrubbed. */
export function scrubConfig(v, keyName = '') {
  if (keyName === 'updatePublicKey' && typeof v === 'string' && v) return `[set; sha256 ${short(sha256(v.trim()))}]`;
  if (keyName && SECRET_KEY.test(keyName)) return '[redacted]';
  if (Array.isArray(v)) return v.map((x) => scrubConfig(x));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = scrubConfig(x, k);
    return out;
  }
  return typeof v === 'string' ? scrubText(v) : v;
}

const isAbs = (p) => win32.isAbsolute(p) || posix.isAbsolute(p);
const baseOf = (p) => String(p).split(/[\\/]/).pop();

/**
 * Where an allow-listed file goes and how it is installed.
 *   worker  swap when idle + restart JICATE workers + health check (never created)
 *   stage   written as <target>.new; run-jicate-box-agent.cmd installs it
 *   (skip)  run-jicate-box-agent.cmd: install-by-hand only; target kept for reports
 *   install written straight to target (backup kept)
 * check: `node --check` first. fill: carry this box's paths into placeholders.
 * utf16: written to disk as UTF-16LE with a BOM (task XML). crlf: refused
 * unless every line ends in CRLF (cmd.exe misreads a batch file without).
 */
export function installPlan(name, { here, mailClientPath } = {}) {
  if (!BOX_FILES.includes(name)) return { skip: `${name} is not a file this agent installs` };
  const at = (n) => resolve(here, n);
  switch (name) {
    case 'jicate-ai-drain.mjs': return { kind: 'worker', target: at(name), check: true, fill: false };
    case 'run-jicate-ai-drain.cmd': return { kind: 'worker', target: at(name), check: false, fill: true, crlf: true };
    case 'jicate-box-agent.mjs': return { kind: 'stage', target: at(name), check: true, fill: false };
    case 'run-jicate-box-agent.cmd': return { target: at(name), skip: 'launcher is install-by-hand only: run-jicate-box-agent.cmd not installed' };
    case 'jicate-mail.mjs': {
      if (!mailClientPath) return { skip: 'box-agent.json has no mailClientPath; jicate-mail.mjs not installed' };
      const p = String(mailClientPath);
      if (!isAbs(p) || baseOf(p) !== 'jicate-mail.mjs') return { skip: 'mailClientPath must be a full path ending in jicate-mail.mjs' };
      return { kind: 'install', target: p, check: true, fill: false };
    }
    // Published as UTF-8 text (signed and hashed as such); written as UTF-16LE +
    // BOM, because the XML declares UTF-16 and schtasks wants that.
    default: return { kind: 'install', target: at(name), check: false, fill: false, utf16: true };
  }
}

/**
 * Fills `set "VAR=__NAME__"` placeholders in a published launcher with the
 * value the live launcher on this box has for VAR (__NODE_EXE__ falls back to
 * this node). Returns { text } or { error } when one cannot be filled.
 */
export function fillPlaceholders(text, liveText, execPath) {
  const live = {};
  for (const m of String(liveText || '').matchAll(/^\s*set\s+"([A-Za-z_][\w]*)=([^"\r\n]*)"/gim)) {
    if (!m[2].includes('__')) live[m[1].toUpperCase()] = m[2];
  }
  let error = null;
  const out = String(text).replace(/^(\s*set\s+"([A-Za-z_][\w]*)=)__([A-Z][A-Z0-9_]*)__(")/gim, (all, head, v, ph, tail) => {
    let val = live[v.toUpperCase()];
    if (val == null && ph === 'NODE_EXE' && execPath) val = execPath;
    if (val == null || /["%\r\n]/.test(val)) { error = error || `cannot fill __${ph}__ (no ${v} on this box)`; return all; }
    return `${head}${val}${tail}`;
  });
  if (!error && /__[A-Z][A-Z0-9_]*__/.test(out.replace(/^\s*(REM|::).*$/gim, ''))) error = 'a placeholder is left that this agent cannot fill';
  return error ? { error } : { text: out };
}

/** True when every line break is CRLF (no bare LF, no bare CR). */
export function isCrlf(text) {
  const t = String(text);
  return !/(^|[^\r])\n/.test(t) && !/\r(?!\n)/.test(t);
}

export const OWN_TASK_REASON = "agent's own task: register by hand once with the Director watching";

/** Why a register-task command is refused, or null. Never the agent's own task or its XML. */
export function registerTaskRefusal(task, xml, agentTask = 'ai.jicate.box-agent') {
  if (typeof task !== 'string' || !/^[\w.-]{1,100}$/.test(task)) return 'task name missing or not allowed';
  if (/box-agent/i.test(task) || task.toLowerCase() === String(agentTask).toLowerCase() || xml === 'ai.jicate.box-agent.xml') return OWN_TASK_REASON;
  if (!XML_FILES.includes(xml)) return `xml must be one of ${XML_FILES.filter((n) => n !== 'ai.jicate.box-agent.xml').join(', ')}`;
  return null;
}

/** `schtasks /query /xml` output for a report: no declaration, no indentation, scrubbed, capped. */
export function trimTaskXml(text, max = 4000) {
  const t = scrubText(String(text || '').replace(/^\uFEFF/, '').replace(/<\?xml[^>]*\?>/i, '').replace(/>\s+</g, '><').trim());
  return t.length > max ? `${t.slice(0, max)}...[cut]` : t;
}

/** Task XML as schtasks wants it: UTF-16LE with a BOM and a matching declaration. */
export function xmlForSchtasks(buf) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString('utf8');
  else text = buf.toString('utf8');
  text = text.replace(/^(\s*<\?xml[^>]*?encoding=["'])[^"']*(["'])/i, '$1UTF-16$2');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/** The last `max` bytes of a buffer as text. */
export function tailText(buf, max = 4096) {
  const b = buf.length > max ? buf.subarray(buf.length - max) : buf;
  return b.toString('utf8').replace(/^\uFFFD+/, '');
}

/** Sum of api_cost_usd over the last `days` days of a log (drain log lines or JSON lines). */
export function costSum(text, nowMs, days = 7) {
  const from = nowMs - days * 86_400_000;
  let usd = 0;
  let jobs = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('cost')) continue;
    let t = NaN;
    let c = NaN;
    const iso = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
    if (iso) {
      t = Date.parse(iso[1]);
      const m = line.match(/api_cost_usd=([\d.]+)/);
      if (m) c = Number(m[1]);
    } else if (line.trim().startsWith('{')) {
      try {
        const j = JSON.parse(line);
        t = Date.parse(j.ts || j.at || j.time || j.timestamp || j.date || '');
        c = Number(j.api_cost_usd ?? j.total_cost_usd ?? j.cost_usd);
      } catch { /* not JSON */ }
    }
    if (Number.isFinite(t) && Number.isFinite(c) && t >= from && t <= nowMs + 60_000) { usd += c; jobs += 1; }
  }
  return { usd: Math.round(usd * 10_000) / 10_000, jobs, days };
}

/** Status, last run and last result from `schtasks /query /fo LIST /v` (English Windows). */
export function parseTaskList(text) {
  const pick = (label) => {
    const m = String(text).match(new RegExp(`^${label}:\\s*(.*)$`, 'im'));
    return m ? m[1].trim() : null;
  };
  return {
    state: pick('Status'), last_run: pick('Last Run Time'), last_result: pick('Last Result'),
    next_run: pick('Next Run Time'), run_as: pick('Run As User'), logon_mode: pick('Logon Mode'),
  };
}

// ---- runtime state (set by init) -------------------------------------------

let BASE = '';
let TOKEN = '';
let config = { restartTasks: [] };
let RESTART = [];
let UPDATE_KEY = null;
let BOX = '';
let AGENT_TASK = 'ai.jicate.box-agent';
const RUN_ID = randomUUID();

const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), '[box-agent]', ...a);
const said = new Set();
/** Log a line only the first time this key is seen (per agent run). */
const once = (key, msg) => { if (!said.has(key)) { said.add(key); log(msg); } };
const errText = (e, n = 160) => String(e?.message || e).slice(0, n);

function envValue(key) {
  try {
    for (const raw of readFileSync(resolve(HERE, 'box-agent.env'), 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/^\uFEFF/, '');
      if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* missing */ }
  return '';
}

function init() {
  BASE = envValue('JICATE_AI_URL').replace(/\/+$/, '');
  TOKEN = envValue('JICATE_AI_RUNNER_TOKEN');
  if (!BASE || TOKEN.length < 32) {
    console.error('[box-agent] box-agent.env is missing JICATE_AI_URL or the agent token');
    process.exit(1);
  }
  try { config = JSON.parse(readFileSync(resolve(HERE, 'box-agent.json'), 'utf8')); } catch { /* none */ }
  RESTART = normalizeRestart(config);
  if (config.updatePublicKey) {
    try { UPDATE_KEY = parseUpdateKey(config.updatePublicKey); } catch (e) {
      log(`updatePublicKey in box-agent.json is not usable (${errText(e, 120)}); file updates and commands are off`);
    }
  }
  BOX = String(config.box || hostname());
  if (typeof config.agentTask === 'string' && SAFE.test(config.agentTask)) AGENT_TASK = config.agentTask;
  fstate = filesRead();
  cstate = cmdRead();
}

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

const STOP_PS = [
  "$m = $env:JM_MATCH",
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m) -and $_.ProcessId -ne $PID -and $_.ProcessId -ne [int]$env:JM_SELF } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
].join('; ');

/** Stop every process (not this agent) whose command line contains `match`. */
function stopMatching(match) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', STOP_PS], {
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
    try { stopMatching(match); } catch (e) { log(`could not stop "${match}": ${errText(e, 120)}`); }
  }
  for (const { task } of list) {
    try {
      execFileSync('schtasks', ['/run', '/tn', task], { stdio: 'ignore', windowsHide: true });
      done.push(task);
    } catch (e) {
      log(`could not restart ${task}: ${errText(e, 120)}`);
    }
  }
  return done;
}

/** Runs a program without blocking the loop; never throws. */
function run(file, args, { timeoutMs = 30_000, env } = {}) {
  return new Promise((done) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      done({
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        timedOut: Boolean(err && err.killed),
        error: err && typeof err.code !== 'number' ? errText(err, 200) : null,
      });
    });
  });
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); }),
  ]);
}

// ---- file updates --------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
const HEALTH_MS = 3 * 60_000; // workers must check in again within this after a swap
const LIVE_MS = 5 * 60_000; // a worker seen this recently before a swap must come back

function shaOfFile(path) {
  try { return sha256(readFileSync(path)); } catch { return null; }
}

const FSTATE = resolve(HERE, 'box-agent.files.json');
function filesRead() {
  try {
    const s = JSON.parse(readFileSync(FSTATE, 'utf8'));
    return {
      failed: Array.isArray(s.failed) ? s.failed : [],
      pending: s.pending || null,
      known: s.known && typeof s.known === 'object' ? s.known : {},
      reported: typeof s.reported === 'string' ? s.reported : null,
    };
  } catch { return { failed: [], pending: null, known: {}, reported: null }; }
}
let fstate = { failed: [], pending: null, known: {}, reported: null };
function filesWrite() {
  fstate.failed = fstate.failed.slice(-50);
  writeFileSync(FSTATE, JSON.stringify(fstate));
}
function markFailed(tag) {
  if (!fstate.failed.includes(tag)) fstate.failed.push(tag);
  filesWrite();
}
/** Remember that the bytes `disk` on this box came from the published sha `source`. */
function markKnown(name, source, disk) {
  fstate.known[name] = { source, disk };
  filesWrite();
}
const staged = {}; // name -> { source, disk } already downloaded, verified and checked as <stage>
const retryAfter = {}; // tag -> local time; a failed download is tried again after 30 min
let exitWhenIdle = false; // a staged update of this agent or its launcher waits for a restart

const planFor = (name) => installPlan(name, { here: HERE, mailClientPath: config.mailClientPath });

/** True when the file at `target` is (a box-adapted copy of) published sha `sha`. */
function upToDate(name, target, sha) {
  const cur = shaOfFile(target);
  if (cur === sha) return true;
  const k = fstate.known[name];
  return Boolean(k && k.source === sha && k.disk === cur);
}

/**
 * The sha of every allow-listed file on this box, for files_applied. A file the
 * agent installed from a signed row and adapted for this box (task XML written
 * as UTF-16, a launcher with this box's paths) is reported as the published
 * sha it came from, as long as the bytes on disk are still exactly what the
 * agent wrote; anything else is reported as the sha of its bytes on disk.
 * Omitted while a swap awaits its health check.
 */
function filesReport() {
  if (fstate.pending) return undefined;
  const out = {};
  for (const name of BOX_FILES) {
    const plan = planFor(name);
    if (!plan.target) continue;
    const sha = shaOfFile(plan.target);
    const k = fstate.known[name];
    if (sha) out[name] = k && k.disk === sha ? k.source : sha;
  }
  return Object.keys(out).length ? out : undefined;
}

function appliedLabel() {
  const l = stateRead() || 'default';
  return l === 'default' ? null : l;
}

/**
 * Posts what this box runs. A Tower that does not know the newer file names
 * yet answers 400; then only the worker is reported, as before.
 */
async function reportFiles(extra = {}) {
  const all = filesReport();
  try {
    await call('POST', '', { applied: appliedLabel(), ...extra, ...(all ? { files: all } : {}) });
  } catch (e) {
    if (!all || !/^400:/.test(errText(e))) throw e;
    const worker = all['jicate-ai-drain.mjs'];
    await call('POST', '', { applied: appliedLabel(), ...extra, ...(worker ? { files: { 'jicate-ai-drain.mjs': worker } } : {}) });
  }
  fstate.reported = JSON.stringify(all || {});
  filesWrite();
}

async function reportFilesIfChanged() {
  if (fstate.pending) return;
  const now = JSON.stringify(filesReport() || {});
  if (now !== fstate.reported) await reportFiles();
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
  if (shaOfFile(resolve(HERE, p.name)) !== (p.disk || p.to)) {
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
    fstate.known[p.name] = { source: p.to, disk: p.disk || p.to };
    const pending = fstate.pending;
    fstate.pending = null; // so the report includes this file
    try {
      await reportFiles();
    } catch (e) {
      fstate.pending = pending; // report again next minute, as before
      throw e;
    }
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

/** Downloads one published file and checks its sha twice and its signature. Throws { retry } on a network failure. */
async function downloadVerified(f) {
  let got;
  try {
    got = await call('GET', `?file=${encodeURIComponent(f.name)}`);
  } catch (e) {
    throw Object.assign(new Error(`download failed (${errText(e, 120)})`), { retry: true });
  }
  if (!got || typeof got.content !== 'string') throw new Error('reply has no content');
  const bytes = Buffer.from(got.content, 'utf8');
  const sha = sha256(bytes);
  if (sha !== f.sha256 || got.sha256 !== f.sha256) throw new Error(`sha mismatch (bytes ${short(sha)}, reply ${short(got.sha256)})`);
  const sig = Buffer.from(String(got.signature || ''), 'base64');
  if (sig.length !== 64 || !verifySignature(null, bytes, UPDATE_KEY, sig)) throw new Error('signature does not verify');
  return bytes;
}

/** `node --check` a .mjs file; throws if it does not parse. */
function nodeCheck(path) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'ignore', windowsHide: true, timeout: 60_000 });
  } catch {
    throw new Error('node --check failed');
  }
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

/** The worker files: swap when idle, restart the JICATE workers, health check. */
async function updateFile(d, gotAt, f, cur, plan) {
  const path = resolve(HERE, f.name);
  const stage = resolve(HERE, plan.check ? stageName(f.name) : `${f.name}.new`);
  const tag = `${f.name}:${f.sha256}`;
  if (staged[f.name]?.source !== f.sha256 || shaOfFile(stage) !== staged[f.name]?.disk) {
    staged[f.name] = null;
    let bytes;
    try {
      bytes = await downloadVerified(f);
    } catch (e) {
      if (e.retry) {
        retryAfter[tag] = Date.now() + 30 * 60_000;
        log(`file ${f.name} ${short(f.sha256)} ${errText(e, 120)}; trying again in 30 min`);
      } else {
        markFailed(tag);
        log(`file ${f.name} ${short(f.sha256)} rejected (${errText(e)}); keeping ${short(cur)}`);
      }
      return;
    }
    try {
      let out = bytes;
      if (plan.crlf && !isCrlf(bytes.toString('utf8'))) throw new Error('not CRLF line endings throughout');
      if (plan.fill) {
        const r = fillPlaceholders(bytes.toString('utf8'), readText(path), process.execPath);
        if (r.error) throw new Error(r.error);
        out = Buffer.from(r.text, 'utf8');
        if (sha256(out) === cur) {
          // The box already runs this launcher (its own paths filled in).
          markKnown(f.name, f.sha256, cur);
          log(`file ${f.name} ${short(f.sha256)} is already on this box`);
          return;
        }
      }
      writeFileSync(stage, out);
      if (plan.check) nodeCheck(stage);
      staged[f.name] = { source: f.sha256, disk: sha256(out) };
      log(`file ${f.name} ${short(cur)} -> ${short(f.sha256)} staged; swapping when workers are idle`);
    } catch (e) {
      try { unlinkSync(stage); } catch { /* none */ }
      markFailed(tag);
      log(`file ${f.name} ${short(f.sha256)} rejected (${errText(e)}); keeping ${short(cur)}`);
      return;
    }
  }
  const only = workerTasks(f.name);
  if (!RESTART.some(only)) {
    // Nothing would restart: the old workers would keep running the old code and
    // still pass the health check, so the box would report a version it does not run.
    try { unlinkSync(stage); } catch { /* none */ }
    staged[f.name] = null;
    markFailed(tag);
    log(`file ${f.name} ${short(f.sha256)} not installed: no worker task in restartTasks matches it; keeping ${short(cur)}`);
    return;
  }
  if ((d.busy ?? 0) > 0 && fileWaited < MAX_WAIT_CHECKS) {
    fileWaited += 1;
    log(`waiting: ${d.busy} job(s) running on this box (${fileWaited}/${MAX_WAIT_CHECKS}) before file update`);
    return;
  }
  fileWaited = 0;
  const backup = `${f.name}.bak-${short(cur)}`;
  const before = serverNow(d, gotAt);
  const live = (d.workers || [])
    .filter((w) => before - Date.parse(w.last_seen_at || '') < LIVE_MS)
    .map((w) => w.name);
  const disk = staged[f.name].disk;
  let swapped = false;
  try {
    copyFileSync(path, resolve(HERE, backup));
    // Recorded BEFORE the swap: if the agent stops anywhere after this, the next
    // run finishes the restart and the health check instead of trusting the file.
    fstate.pending = {
      name: f.name, from: cur, to: f.sha256, ...(disk !== f.sha256 ? { disk } : {}),
      backup, at: null, workers: live, restarting: true,
    };
    filesWrite();
    renameSync(stage, path);
    swapped = true;
    staged[f.name] = null;
    const restarted = restartTasks(only);
    if (!restarted.length) throw new Error('no worker task could be restarted');
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
    log(`file ${f.name} ${short(f.sha256)} swap failed (${errText(e)}); ${swapped ? 'restored' : 'kept'} ${short(cur)}${swapped ? '' : '; trying again in 30 min'}`);
  }
}

/** True when run-jicate-box-agent.cmd on disk installs a staged `<marker>`. */
function launcherApplies(marker) {
  return readText(resolve(HERE, 'run-jicate-box-agent.cmd')).includes(marker);
}

/** Every other file: stage (this agent, its launcher) or install (mail client, task XML). */
async function installOther(f, plan) {
  const tag = `${f.name}:${f.sha256}`;
  const target = plan.target;
  const cur = shaOfFile(target);
  let bytes;
  try {
    bytes = await downloadVerified(f);
    if (plan.crlf && !isCrlf(bytes.toString('utf8'))) throw new Error('not CRLF line endings throughout');
    if (plan.fill) {
      const r = fillPlaceholders(bytes.toString('utf8'), readText(target), process.execPath);
      if (r.error) throw new Error(r.error);
      bytes = Buffer.from(r.text, 'utf8');
    }
    if (plan.utf16) bytes = xmlForSchtasks(bytes);
  } catch (e) {
    if (e.retry) {
      retryAfter[tag] = Date.now() + 30 * 60_000;
      log(`file ${f.name} ${short(f.sha256)} ${errText(e, 120)}; trying again in 30 min`);
    } else {
      markFailed(tag);
      log(`file ${f.name} ${short(f.sha256)} rejected (${errText(e)}); keeping ${short(cur) || 'nothing'}`);
    }
    return;
  }
  const disk = sha256(bytes);
  if (disk === cur) {
    markKnown(f.name, f.sha256, disk);
    log(`file ${f.name} ${short(f.sha256)} is already on this box`);
    return;
  }
  // Temp copy next to the target, never the target itself: .new.mjs for node
  // --check (node parses only .mjs as ESM), <name>.tmp otherwise.
  const tmp = plan.check ? resolve(dirname(target), stageName(f.name)) : `${target}.tmp`;
  try {
    if (tmp === target) throw new Error('temp path equals the target');
    if (plan.kind === 'stage') {
      const next = `${target}.new`;
      writeFileSync(tmp, bytes);
      if (plan.check) nodeCheck(tmp);
      renameSync(tmp, next);
      markKnown(f.name, f.sha256, disk);
      const marker = `${f.name}.new`;
      if (launcherApplies(marker)) {
        exitWhenIdle = true;
        log(`file ${f.name} ${short(cur)} -> ${short(f.sha256)} staged as ${marker}; the agent restarts when idle and the launcher installs it`);
      } else {
        log(`file ${f.name} ${short(f.sha256)} staged as ${marker}, but run-jicate-box-agent.cmd does not install staged files; install the new launcher by hand`);
      }
      return;
    }
    if (!existsSync(dirname(target))) throw new Error(`folder ${dirname(target)} does not exist`);
    writeFileSync(tmp, bytes);
    if (plan.check) nodeCheck(tmp);
    if (cur) copyFileSync(target, `${target}.bak-${short(cur)}`);
    renameSync(tmp, target);
    markKnown(f.name, f.sha256, disk);
    log(`file installed ${f.name} ${short(cur) || '(new)'} -> ${short(f.sha256)} at ${target}`);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* none */ }
    if (/node --check/.test(errText(e))) markFailed(tag);
    else retryAfter[tag] = Date.now() + 30 * 60_000;
    log(`file ${f.name} ${short(f.sha256)} not installed (${errText(e)}); keeping ${short(cur) || 'nothing'}`);
    return;
  }
  try { await reportFiles(); } catch (e) { once(`report:${errText(e, 60)}`, `file report failed: ${errText(e)}`); }
}

async function applyFiles(d, gotAt) {
  if (fstate.pending) return healthCheck(d, gotAt);
  const wanted = (d.files || []).filter((f) => f && BOX_FILES.includes(f.name) && HEX64.test(f.sha256 || ''));
  if (wanted.length && !UPDATE_KEY) {
    once('nokey', 'file updates are published but box-agent.json has no usable updatePublicKey; not applying them');
    return;
  }
  for (const f of wanted) {
    const plan = planFor(f.name);
    if (plan.skip) { once(`skip:${f.name}`, plan.skip); continue; }
    const tag = `${f.name}:${f.sha256}`;
    if (plan.kind === 'worker') {
      const cur = shaOfFile(plan.target);
      if (!cur) { once(`missing:${f.name}`, `${f.name} is not on this box; not creating it`); continue; }
      if (upToDate(f.name, plan.target, f.sha256)) continue;
      if (fstate.failed.includes(tag)) { once(`failed:${tag}`, `file ${f.name} ${short(f.sha256)} failed before; not trying it again`); continue; }
      if ((retryAfter[tag] ?? 0) > Date.now()) continue;
      await updateFile(d, gotAt, f, cur, plan);
      return; // one file per check
    }
    if (upToDate(f.name, plan.target, f.sha256)) continue;
    const k = fstate.known[f.name];
    if (plan.kind === 'stage' && k && k.source === f.sha256) {
      if (shaOfFile(`${plan.target}.new`) === k.disk) { once(`staged:${tag}`, `file ${f.name} ${short(f.sha256)} is staged; waiting for the launcher`); continue; }
      if (shaOfFile(`${plan.target}.rejected`) === k.disk) {
        markFailed(tag);
        log(`file ${f.name} ${short(f.sha256)} was rejected by the launcher; not trying it again`);
        continue;
      }
    }
    if (fstate.failed.includes(tag)) { once(`failed:${tag}`, `file ${f.name} ${short(f.sha256)} failed before; not trying it again`); continue; }
    if ((retryAfter[tag] ?? 0) > Date.now()) continue;
    await installOther(f, plan);
    return; // one file per check
  }
}

// ---- commands ---------------------------------------------------------------

const CSTATE = resolve(HERE, 'box-agent.commands.json');
function cmdRead() {
  try {
    const s = JSON.parse(readFileSync(CSTATE, 'utf8'));
    return { ledger: s.ledger && typeof s.ledger === 'object' ? s.ledger : {}, lastStatusAt: Number(s.lastStatusAt) || 0 };
  } catch { return { ledger: {}, lastStatusAt: 0 }; }
}
let cstate = { ledger: {}, lastStatusAt: 0 };
function cmdWrite() {
  writeFileSync(CSTATE, JSON.stringify(cstate));
}

const inflight = new Map(); // command id -> promise
let commandsTicking = false;
let statusInflight = null;
const MAX_INFLIGHT = 4;
const STATUS_EVERY_MS = 5 * 60_000;
// restart-task may first wait up to MAX_WAIT_CHECKS polls for idle workers.
const VERB_TIMEOUT_MS = { status: 120_000, 'restart-task': 15 * 60_000, 'register-task': 90_000 };

/** An earlier agent run stopped while these ran: they are failed, never run again. */
function failInterrupted() {
  let changed = false;
  for (const e of Object.values(cstate.ledger)) {
    if (!e.final && e.run !== RUN_ID) {
      Object.assign(e, { final: 'failed', result: { reason: 'the box agent stopped while this command was running' }, sent: false });
      changed = true;
    }
  }
  if (changed) cmdWrite();
}

function pruneLedger(now) {
  for (const [id, e] of Object.entries(cstate.ledger)) {
    // Once expired a payload is refused anyway, so its id need not be remembered.
    if (e.final && (e.exp ?? 0) + 3_600_000 < now && (e.sent || (e.exp ?? 0) + 48 * 3_600_000 < now)) delete cstate.ledger[id];
  }
}

const MAX_REPORT_CHARS = 100_000; // the Tower refuses more than 128 KB of JSON

/**
 * Keeps a result or report well under the Tower's size cap: drops the oldest
 * log lines first, then the task XML, then shortens what is left.
 */
export function capReport(r) {
  const size = (x) => JSON.stringify(x ?? null).length;
  if (size(r) <= MAX_REPORT_CHARS) return r;
  const out = { ...r, truncated: true };
  if (Array.isArray(out.log_tail)) {
    out.log_tail = [...out.log_tail];
    while (out.log_tail.length && size(out) > MAX_REPORT_CHARS) out.log_tail.shift();
    if (size(out) <= MAX_REPORT_CHARS) return out;
  }
  if (Array.isArray(out.tasks)) out.tasks = out.tasks.map((t) => (t && typeof t === 'object' ? { ...t, xml: undefined } : t));
  if (out.agent_task && typeof out.agent_task === 'object') out.agent_task = { ...out.agent_task, xml: undefined };
  if (size(out) <= MAX_REPORT_CHARS) return out;
  for (const k of ['config', 'tasks', 'files_failed', 'output']) {
    if (k in out) out[k] = Array.isArray(out[k]) ? out[k].slice(-3) : typeof out[k] === 'string' ? out[k].slice(-1000) : '[too large]';
    if (size(out) <= MAX_REPORT_CHARS) return out;
  }
  return { truncated: true, reason: 'result too large to send' };
}

/**
 * Reports a command's state. No `applied`: that would touch the account.
 * Returns 'sent', 'gone' (moved:false - the row is terminal, another box's or
 * missing: stop working on it) or 'error' (try again later).
 */
async function postUpdate(id, status, result, verb) {
  const capped = result === undefined ? undefined : capReport(result);
  const body = { command_update: { id, status, ...(capped !== undefined ? { result: capped } : {}) } };
  if (verb === 'status' && status === 'done' && capped && !capped.reason) body.status_report = capped;
  try {
    const r = await call('POST', '', body);
    return r?.command?.moved === false ? 'gone' : 'sent';
  } catch (e) {
    once(`cmdpost:${errText(e, 60)}`, `could not report command ${id} ${status}: ${errText(e)}`);
    return 'error';
  }
}

async function finish(id, status, result) {
  const e = cstate.ledger[id];
  Object.assign(e, { final: status, result, sent: false, done_at: Date.now() });
  cmdWrite();
  log(`command ${id} ${e.verb}: ${status}${result?.reason ? ` (${scrubText(result.reason).slice(0, 160)})` : ''}`);
  const sent = await postUpdate(id, status, result, e.verb);
  if (sent === 'gone') log(`command ${id}: the Tower had already closed it (e.g. "agent stopped" after expiry); result not stored there`);
  if (sent !== 'error') {
    e.sent = true;
    delete e.result;
    cmdWrite();
  }
}

async function flushUnsent() {
  for (const [id, e] of Object.entries(cstate.ledger)) {
    if (!e.final || e.sent || inflight.has(id)) continue;
    const sent = await postUpdate(id, e.final, e.result, e.verb);
    if (sent === 'gone') log(`command ${id}: the Tower had already closed it; result not stored there`);
    if (sent !== 'error') {
      e.sent = true;
      delete e.result;
      cmdWrite();
    }
  }
}

/**
 * Waits in the background until the Tower says no JICATE job runs on this box,
 * for at most MAX_WAIT_CHECKS polls - the account switch's rule. `busy` is
 * box-wide (the Tower does not map tasks to workers).
 */
async function waitForIdleWorkers() {
  const fromTick = towerTicks;
  const startedAt = Date.now();
  const wallCap = (MAX_WAIT_CHECKS + 2) * EVERY_MS; // polls may fail; never wait forever
  while (towerBusy > 0 && towerTicks - fromTick < MAX_WAIT_CHECKS && Date.now() - startedAt < wallCap) {
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return { waited_s: Math.round((Date.now() - startedAt) / 1000), busy_at_restart: towerBusy };
}

async function restartTaskCommand(args) {
  const sel = restartSelection(RESTART, args.task, AGENT_TASK);
  if (sel.error) return { status: 'refused', result: { reason: sel.error } };
  const force = args.force === true;
  const jicate = sel.list.some(workerTasks('jicate-ai-drain.mjs'));
  let wait = null;
  if (jicate && !force) {
    if (towerBusy > 0) log(`restart-task ${args.task}: waiting for ${towerBusy} job(s) on this box (up to ${MAX_WAIT_CHECKS} min)`);
    wait = await waitForIdleWorkers();
  }
  const waitInfo = { forced: force, ...(wait || {}), ...(jicate ? {} : { idle_check: 'jobs of non-JICATE tasks are not visible to the Tower; not waited' }) };
  for (const { task } of sel.list) await run('schtasks', ['/end', '/tn', task], { timeoutMs: 30_000 });
  for (const match of new Set(sel.list.map((t) => t.match).filter(Boolean))) {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', STOP_PS], {
      timeoutMs: 60_000, env: { ...process.env, JM_MATCH: match, JM_SELF: String(process.pid) },
    });
    if (r.code !== 0) log(`could not stop "${match}": ${scrubText(r.stderr || r.error || '').slice(0, 120)}`);
  }
  const restarted = [];
  const failed = [];
  for (const { task } of sel.list) {
    const r = await run('schtasks', ['/run', '/tn', task], { timeoutMs: 30_000 });
    if (r.code === 0) restarted.push(task);
    else failed.push({ task, error: scrubText((r.stderr || r.stdout || r.error || '').trim()).slice(0, 200) });
  }
  return { status: restarted.includes(args.task) ? 'done' : 'failed', result: { restarted, failed, ...waitInfo } };
}

async function registerTaskCommand(args, files) {
  const { task, xml } = args;
  const refusal = registerTaskRefusal(task, xml, AGENT_TASK);
  if (refusal) return { status: 'refused', result: { reason: refusal } };
  const path = resolve(HERE, xml);
  const disk = shaOfFile(path);
  const k = fstate.known[xml];
  const listed = (files || []).find((f) => f && f.name === xml)?.sha256;
  if (!disk || !k || k.disk !== disk) return { status: 'failed', result: { reason: `${xml} on this box was not installed by the agent from a signed file` } };
  if (listed && listed !== k.source) return { status: 'failed', result: { reason: `${xml} on this box is not the version the Tower lists now; wait for the agent to install it` } };
  const tmp = resolve(HERE, `${xml}.register.tmp`);
  try {
    writeFileSync(tmp, xmlForSchtasks(readFileSync(path)));
    const r = await run('schtasks', ['/create', '/tn', task, '/xml', tmp, '/f'], { timeoutMs: 60_000 });
    const out = `${r.stdout}\n${r.stderr}\n${r.error || ''}`.trim();
    if (r.code === 0) return { status: 'done', result: { registered: task, xml, sha256: disk } };
    if (/access is denied|0x80070005/i.test(out)) return { status: 'failed', result: { reason: 'needs admin; register once by hand' } };
    return { status: 'failed', result: { reason: r.timedOut ? 'schtasks timed out' : scrubText(out).slice(-400) || `schtasks exit ${r.code}` } };
  } finally {
    try { unlinkSync(tmp); } catch { /* none */ }
  }
}

/** A Director-signed script, in its own hidden child process. Its output is returned, never logged. */
function runScriptCommand(id, args) {
  const shell = args.shell;
  if (shell !== 'powershell' && shell !== 'cmd') return Promise.resolve({ status: 'refused', result: { reason: 'shell must be powershell or cmd' } });
  const limit = args.timeout_s == null ? 300 : Number(args.timeout_s);
  if (!Number.isInteger(limit) || limit < 1 || limit > 600) return Promise.resolve({ status: 'refused', result: { reason: 'timeout_s must be a whole number from 1 to 600' } });
  const content = typeof args.content_b64 === 'string' ? Buffer.from(args.content_b64, 'base64') : Buffer.alloc(0);
  if (!content.length || content.length > 256 * 1024) return Promise.resolve({ status: 'refused', result: { reason: 'content_b64 missing or larger than 256 KB' } });
  const dir = resolve(HERE, 'scripts');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${id}.${shell === 'powershell' ? 'ps1' : 'cmd'}`);
  // UTF-8 BOM so Windows PowerShell 5.1 reads non-ASCII text correctly.
  writeFileSync(file, shell === 'powershell' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]) : content);
  const [exe, argv] = shell === 'powershell'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file]]
    : ['cmd.exe', ['/d', '/c', file]];
  const started = Date.now();
  return new Promise((done) => {
    let tail = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    const keep = (chunk) => {
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > 8192) tail = tail.subarray(tail.length - 4096);
    };
    const end = (status, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unlinkSync(file); } catch { /* none */ }
      done({ status, result: { ...extra, timed_out: timedOut, seconds: Math.round((Date.now() - started) / 1000), output: tailText(tail, 4096) } });
    };
    let child;
    try {
      child = spawn(exe, argv, { cwd: HERE, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      end('failed', { reason: `could not start ${shell}: ${errText(e, 120)}` });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the whole tree: the shell's own children must not outlive the limit.
      execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, () => {});
      setTimeout(() => end('failed', { reason: `timed out after ${limit} s`, exit_code: null }), 15_000);
    }, limit * 1000);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (e) => end('failed', { reason: `could not start ${shell}: ${errText(e, 120)}`, exit_code: null }));
    child.on('close', (code) => end(code === 0 && !timedOut ? 'done' : 'failed', { exit_code: code }));
  });
}

async function execute(id, payload, files) {
  switch (payload.verb) {
    case 'status': return { status: 'done', result: await buildStatus() };
    case 'restart-task': return restartTaskCommand(payload.args);
    case 'register-task': return registerTaskCommand(payload.args, files);
    case 'run-script': return runScriptCommand(id, payload.args);
    default: return { status: 'refused', result: { reason: 'unknown verb' } };
  }
}

function startCommand(id, payload, files) {
  const limit = VERB_TIMEOUT_MS[payload.verb];
  const work = execute(id, payload, files);
  const p = (limit ? withTimeout(work, limit, payload.verb) : work)
    .then((r) => finish(id, r.status, r.result))
    .catch((e) => finish(id, 'failed', { reason: scrubText(errText(e, 300)) }))
    .catch((e) => once(`finish:${errText(e, 60)}`, `command bookkeeping failed: ${errText(e)}`))
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
}

async function commandsTick(d, gotAt) {
  const now = Date.now();
  pruneLedger(now);
  await flushUnsent();
  for (const row of (Array.isArray(d.commands) ? d.commands : []).slice(0, 5)) {
    if (!row || typeof row.id !== 'string' || inflight.has(row.id)) continue;
    const prev = cstate.ledger[row.id];
    if (prev && (!prev.final || !prev.sent)) continue; // still running here, or its result is waiting to be sent
    if (inflight.size >= MAX_INFLIGHT) break;
    const v = verifyCommand(row, { key: UPDATE_KEY, box: BOX, nowMs: serverNow(d, gotAt), ledger: cstate.ledger });
    if (!v.ok) {
      if (UUID.test(String(row.id))) {
        log(`command ${row.id} refused: ${v.reason}`);
        await postUpdate(row.id, 'refused', { reason: v.reason });
      }
      continue;
    }
    // In the ledger BEFORE anything runs: a crash can never run it twice.
    cstate.ledger[row.id] = { verb: v.payload.verb, exp: v.payload.exp, at: Date.now(), run: RUN_ID };
    cmdWrite();
    const sent = await postUpdate(row.id, 'running');
    if (sent === 'error') {
      // The Tower did not hear 'running': nothing ran, so forget it and see it again next minute.
      delete cstate.ledger[row.id];
      cmdWrite();
      continue;
    }
    if (sent === 'gone') {
      // Already terminal (expired, cancelled ...) at the Tower: never run it.
      Object.assign(cstate.ledger[row.id], { final: 'skipped', sent: true });
      cmdWrite();
      log(`command ${row.id} ${v.payload.verb}: no longer queued at the Tower; not running it`);
      continue;
    }
    log(`command ${row.id} ${v.payload.verb}: running`);
    startCommand(row.id, v.payload, d.files);
  }
}

/** Starts the command step in the background; the minute loop never waits for it. */
function startCommands(d, gotAt) {
  if (commandsTicking) return;
  commandsTicking = true;
  commandsTick(d, gotAt)
    .catch((e) => once(`cmds:${errText(e, 60)}`, `command step failed: ${errText(e, 200)}`))
    .finally(() => { commandsTicking = false; });
}

// ---- status report ----------------------------------------------------------

function readTail(path, max) {
  let fd;
  try {
    const size = statSync(path).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return null; } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
  }
}

// Whether Windows signs itself in after a restart: tasks that need a signed-in
// user (InteractiveToken) only run once someone is signed in. Reads the two
// Winlogon values only; never the stored password.
const WINLOGON = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
async function readSignIn() {
  if (process.platform !== 'win32') return null;
  const value = async (v) => {
    const r = await run('reg', ['query', WINLOGON, '/v', v], { timeoutMs: 10_000 });
    if (r.code !== 0) return null;
    return r.stdout.match(new RegExp(`${v}\\s+REG_\\w+\\s+(.*)`, 'i'))?.[1]?.trim() ?? null;
  };
  const [auto, user] = await Promise.all([value('AutoAdminLogon'), value('DefaultUserName')]);
  return { auto_sign_in: auto === '1', user: user || null };
}

async function buildStatus() {
  const files = {};
  const stagedNow = {};
  for (const name of BOX_FILES) {
    const plan = planFor(name);
    if (!plan.target) continue;
    const sha = shaOfFile(plan.target);
    const k = fstate.known[name];
    if (sha) files[name] = { sha256: sha, ...(k && k.disk === sha && k.source !== sha ? { published_sha256: k.source } : {}) };
    if (plan.kind === 'stage') {
      const s = shaOfFile(`${plan.target}.new`);
      if (s) stagedNow[`${name}.new`] = s;
    }
  }
  const [tasks, agentTask, claude, signIn] = await Promise.all([
    Promise.all(RESTART.map(async ({ task }) => {
      const [r, x] = await Promise.all([
        run('schtasks', ['/query', '/tn', task, '/fo', 'LIST', '/v'], { timeoutMs: 20_000 }),
        run('schtasks', ['/query', '/tn', task, '/xml'], { timeoutMs: 20_000 }),
      ]);
      return {
        task,
        ...(r.code === 0 ? parseTaskList(r.stdout) : { error: scrubText((r.stderr || r.error || `exit ${r.code}`).trim()).slice(0, 160) }),
        xml: x.code === 0 ? trimTaskXml(x.stdout) : null,
      };
    })),
    run('schtasks', ['/query', '/tn', AGENT_TASK, '/xml'], { timeoutMs: 20_000 }).then((r) => {
      if (r.code !== 0) return { task: AGENT_TASK, readable: false };
      return {
        task: AGENT_TASK,
        run_level: r.stdout.match(/<RunLevel>([^<]*)</i)?.[1] ?? null,
        logon_type: r.stdout.match(/<LogonType>([^<]*)</i)?.[1] ?? null,
        xml: trimTaskXml(r.stdout),
      };
    }),
    run('cmd.exe', ['/d', '/c', 'claude --version'], { timeoutMs: 20_000 })
      .then((r) => (r.code === 0 ? r.stdout.trim().split(/\r?\n/)[0].slice(0, 80) : null)),
    readSignIn(),
  ]);
  let diskFree = null;
  try {
    const s = statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    diskFree = { drive: process.platform === 'win32' ? 'C:' : '/', free_gb: Math.round((s.bavail * s.bsize) / 1e8) / 10 };
  } catch { /* unknown */ }
  const logText = readTail(resolve(HERE, 'logs', 'box-agent.log'), 64 * 1024);
  const logTail = logText == null ? null : logText.split(/\r?\n/).filter(Boolean).slice(-20).map((l) => scrubText(l).slice(0, 400));
  let cost = null;
  if (config.costLog) {
    const paths = (Array.isArray(config.costLog) ? config.costLog : [config.costLog]).filter((p) => typeof p === 'string').slice(0, 8);
    const sum = { usd: 0, jobs: 0, days: 7, files: 0 };
    for (const p of paths) {
      const text = readTail(resolve(HERE, p), 16 * 1024 * 1024);
      if (text == null) continue;
      const c = costSum(text, Date.now(), 7);
      sum.usd = Math.round((sum.usd + c.usd) * 10_000) / 10_000;
      sum.jobs += c.jobs;
      sum.files += 1;
    }
    cost = sum;
  }
  return {
    at: new Date().toISOString(),
    host: hostname(),
    box: BOX,
    agent_sha256: shaOfFile(SELF),
    node: process.version,
    claude_version: claude,
    uptime_s: Math.round(uptime()),
    booted_at: new Date(Date.now() - uptime() * 1000).toISOString(),
    sign_in: signIn,
    disk: diskFree,
    tasks,
    agent_task: agentTask,
    files,
    staged: stagedNow,
    file_update_pending: fstate.pending ? { name: fstate.pending.name, to: short(fstate.pending.to) } : null,
    files_failed: fstate.failed.slice(-10),
    commands_running: [...inflight.keys()],
    config: scrubConfig(config),
    log_tail: logTail,
    api_cost_7d: cost,
  };
}

function startStatusReport() {
  if (statusInflight || Date.now() - (cstate.lastStatusAt || 0) < STATUS_EVERY_MS) return;
  cstate.lastStatusAt = Date.now();
  cmdWrite();
  statusInflight = withTimeout(buildStatus(), VERB_TIMEOUT_MS.status, 'status report')
    .then((report) => call('POST', '', { status_report: capReport(report) }))
    .catch((e) => once(`status:${errText(e, 60)}`, `status report failed: ${errText(e, 200)}`))
    .finally(() => { statusInflight = null; });
}

// ---- main loop ---------------------------------------------------------------

const MAX_WAIT_CHECKS = 10; // minutes to wait for idle workers before restarting anyway
const SWAP_PROVE_MS = 3 * 60_000; // a freshly swapped agent must reach the Tower within this
let waited = 0; // account switches
let fileWaited = 0; // file updates (own counter)
let towerBusy = 0; // `busy` from the last GET (restart-task waits on it)
let towerTicks = 0; // successful GETs so far (restart-task counts its wait in these)
let reachedTower = false;

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
  await reportFiles({ restarted });
  return false;
}

/** The launcher leaves this marker after installing a staged agent; reaching the Tower clears it. */
function clearSwapMarker() {
  const marker = resolve(HERE, 'jicate-box-agent.swapped');
  if (existsSync(marker)) {
    try { unlinkSync(marker); log('new agent reached the Tower; launcher rollback marker cleared'); } catch { /* next time */ }
  }
}

async function checkOnce() {
  const raw = stateRead() || 'default';
  const owed = raw.endsWith('+restart');
  const have = owed ? raw.slice(0, -'+restart'.length) : raw;
  const d = await call('GET', `?have=${encodeURIComponent(have)}`);
  const gotAt = Date.now();
  towerBusy = d?.busy ?? 0;
  towerTicks += 1;
  reachedTower = true;
  clearSwapMarker();
  let ready = false;
  let accountError = null;
  try { ready = await applyAccount(d, have, owed); } catch (e) { accountError = e; }
  if (ready) {
    try {
      await applyFiles(d, gotAt);
    } catch (e) {
      once(`files:${errText(e, 80)}`, `file update step failed: ${errText(e, 200)}`);
    }
    try { await reportFilesIfChanged(); } catch (e) { once(`report:${errText(e, 60)}`, `file report failed: ${errText(e)}`); }
  }
  // After the account and file steps, in the background: never holds up this loop.
  try { startCommands(d, gotAt); } catch (e) { once(`cmds:${errText(e, 60)}`, `command step failed: ${errText(e)}`); }
  try { startStatusReport(); } catch (e) { once(`status:${errText(e, 60)}`, `status report failed: ${errText(e)}`); }
  if (accountError) throw accountError;
}

/** Nothing owed, nothing running: safe to exit so the launcher installs a staged update. */
function idle() {
  return !fstate.pending && !stateRead().endsWith('+restart') && inflight.size === 0 && !statusInflight && !commandsTicking;
}

async function main() {
  init();
  log(`start host-agent url=${BASE} restartTasks=${RESTART.length} fileUpdates=${UPDATE_KEY ? 'on' : 'off'} commands=${UPDATE_KEY ? 'on' : 'off'} box=${BOX} sha=${short(shaOfFile(SELF))}`);
  failInterrupted();
  // Just installed by the launcher (marker present): if this agent cannot reach
  // the Tower within 3 minutes, exit non-zero so the next launcher run (within a
  // minute) restores the previous agent.
  const justSwapped = existsSync(resolve(HERE, 'jicate-box-agent.swapped'));
  const startedAt = Date.now();
  let fails = 0;
  for (;;) {
    try {
      await checkOnce();
      fails = 0;
    } catch (e) {
      fails += 1;
      if (fails === 1 || fails % 30 === 0) log(`check failed (${fails}): ${errText(e, 200)}`);
    }
    if (ONESHOT) break;
    if (justSwapped && !reachedTower && Date.now() - startedAt >= SWAP_PROVE_MS) {
      log('new agent has not reached the Tower within 3 minutes of starting; exiting so the launcher restores the previous one');
      process.exit(1);
    }
    if (exitWhenIdle && idle()) {
      log('staged update waiting; exiting so run-jicate-box-agent.cmd installs it (the task starts again within a minute)');
      break;
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
  // ONESHOT: let started commands and the status report finish before exiting.
  while (commandsTicking || inflight.size || statusInflight) {
    await Promise.allSettled([...inflight.values(), statusInflight].filter(Boolean));
    if (commandsTicking) await new Promise((r) => setTimeout(r, 500));
  }
}

if (process.env.JICATE_BOX_AGENT_NO_MAIN !== '1') {
  main().catch((e) => {
    console.error(ts(), '[box-agent] fatal:', errText(e, 200));
    process.exit(1);
  });
}
