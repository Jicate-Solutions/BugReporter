#!/usr/bin/env node
// Send a signed command to one Windows box's agent (runs on the Mac, never on
// a box). Pure ASCII on purpose.
//
//   node box-command.mjs <box> <verb> [json-args] [--expires 30m] [--wait]
//                        [--script <file>] [--key <private.pem>] [--dry-run]
//
//   <box>      the box's host, exactly as in ai_boxes.host
//   <verb>     status                      {}
//              restart-task                {"task":"<name in restartTasks>"}
//              register-task               {"task":"<name>","xml":"ai.jicate.<...>.xml"}
//              run-script                  {"shell":"powershell"|"cmd","content_b64":"...","timeout_s":<1..600>}
//                                          (--script <file> fills content_b64 from a file;
//                                           timeout_s defaults to 120)
//   --expires  how long the box may still start it, e.g. 90s, 30m, 2h, 5h55m; default 30m,
//              at most 5h55m (the table allows 6h by ITS clock; 5 minutes spare for clock skew)
//   --wait     poll until the box finishes, then print the result
//   --dry-run  print the signed row and the SQL; touch nothing
//
// Signs {id, box, verb, args, expires_at} (keys in that order) with the
// box-update key (~/.jicate-mail/box-update-signing.pem, same key as
// ai_box_files) and inserts one row into public.ai_box_commands through the
// Supabase Management API (token: ~/.supabase/access-token, never printed).

import { readFileSync, realpathSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { jsonbLiteral, runSql } from './tower-sql.mjs';

export const VERBS = ['status', 'restart-task', 'register-task', 'run-script'];
export const TASK_XMLS = [
  'ai.jicate.engine-1.xml',
  'ai.jicate.engine-2.xml',
  'ai.jicate.engine-3.xml',
  'ai.jicate.engine-4.xml',
  'ai.jicate.box-agent.xml'
];
export const AGENT_TASK = 'ai.jicate.box-agent';
export const DEFAULT_EXPIRES = '30m';
// The table refuses more than 6h after its own now(); 5 minutes spare so a
// Mac clock that differs from the database clock cannot trip that CHECK.
export const MAX_EXPIRY_MS = (5 * 60 + 55) * 60 * 1000;
export const MAX_SCRIPT_BYTES = 64 * 1024;
const TERMINAL = ['done', 'failed', 'refused', 'expired'];
const BOX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const TASK = /^[\\A-Za-z0-9][\\A-Za-z0-9._ -]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** '30m' | '2h' | '5h55m' -> ms. Throws unless 0 < value <= 5h55m. */
export function parseExpires(text) {
  const m = /^(?:(\d{1,4})h)?(?:(\d{1,6})m)?(?:(\d{1,6})s)?$/.exec(String(text));
  if (!m || String(text) === '') throw new Error(`--expires must look like 90s, 30m, 2h or 5h55m (got ${String(text).slice(0, 20)})`);
  const ms = Number(m[1] ?? 0) * 3600000 + Number(m[2] ?? 0) * 60000 + Number(m[3] ?? 0) * 1000;
  if (ms <= 0) throw new Error('--expires must be more than 0');
  if (ms > MAX_EXPIRY_MS) throw new Error('--expires may be at most 5h55m (the Tower refuses more than 6h)');
  return ms;
}

function exactKeys(args, keys) {
  const got = Object.keys(args).sort();
  const want = [...keys].sort();
  return got.length === want.length && got.every((k, i) => k === want[i]);
}

/** Returns an error message, or null when the args are valid for the verb. */
export function validateArgs(verb, args) {
  if (!VERBS.includes(verb)) return `unknown verb ${String(verb).slice(0, 40)} (allowed: ${VERBS.join(', ')})`;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'args must be a JSON object';
  if (verb === 'status') return exactKeys(args, []) ? null : 'status takes no args: {}';
  if (verb === 'restart-task') {
    if (!exactKeys(args, ['task'])) return 'restart-task takes {"task":"<name>"}';
    if (typeof args.task !== 'string' || !TASK.test(args.task)) return 'task is not a valid task name';
    if (args.task.replace(/^\\+/, '').toLowerCase() === AGENT_TASK) return 'the agent never restarts its own task';
    return null;
  }
  if (verb === 'register-task') {
    if (!exactKeys(args, ['task', 'xml'])) return 'register-task takes {"task":"<name>","xml":"<file>"}';
    if (typeof args.task !== 'string' || !TASK.test(args.task)) return 'task is not a valid task name';
    if (!TASK_XMLS.includes(args.xml)) return `xml must be one of ${TASK_XMLS.join(', ')}`;
    return null;
  }
  // run-script
  if (!exactKeys(args, ['shell', 'content_b64', 'timeout_s'])) {
    return 'run-script takes {"shell":"powershell"|"cmd","content_b64":"...","timeout_s":<1..600>}';
  }
  if (args.shell !== 'powershell' && args.shell !== 'cmd') return 'shell must be "powershell" or "cmd"';
  if (typeof args.content_b64 !== 'string' || !BASE64.test(args.content_b64)) return 'content_b64 is not base64';
  const bytes = Buffer.from(args.content_b64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== args.content_b64) return 'content_b64 is not canonical base64';
  if (bytes.length > MAX_SCRIPT_BYTES) return `script is larger than ${MAX_SCRIPT_BYTES} bytes`;
  if (!Number.isInteger(args.timeout_s) || args.timeout_s < 1 || args.timeout_s > 600) return 'timeout_s must be 1..600';
  return null;
}

/** The exact bytes that get signed. Key order matters; do not reorder. */
export function canonicalPayload(c) {
  return JSON.stringify({ id: c.id, box: c.box, verb: c.verb, args: c.args, expires_at: c.expires_at });
}

/** Validate and build the command (unsigned). */
export function buildCommand({ box, verb, args, expiresMs, now = new Date(), id = randomUUID() }) {
  if (!BOX.test(String(box))) throw new Error('box must be the host name as in ai_boxes.host');
  const problem = validateArgs(verb, args);
  if (problem) throw new Error(problem);
  if (!(expiresMs > 0 && expiresMs <= MAX_EXPIRY_MS)) throw new Error('expiry must be more than 0 and at most 5h55m');
  if (!UUID.test(id)) throw new Error('id must be a lowercase uuid');
  const expires_at = new Date(now.getTime() + expiresMs).toISOString();
  const c = { id, box, verb, args, expires_at };
  return { ...c, payload: canonicalPayload(c) };
}

/** base64 Ed25519 signature over the UTF-8 bytes of payload. */
export function signPayload(payload, privateKey) {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('the private key is not Ed25519');
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}

export function insertSql(row) {
  return (
    'insert into public.ai_box_commands (id, box, verb, payload, signature, expires_at, created_by) ' +
    'select id, box, verb, payload, signature, expires_at, created_by ' +
    `from jsonb_populate_record(null::public.ai_box_commands, ${jsonbLiteral(row)}) ` +
    'returning id, status, expires_at;'
  );
}

export function statusSql(id) {
  if (!UUID.test(id)) throw new Error('bad id');
  return `select status, result, started_at, finished_at, expires_at from public.ai_box_commands where id = '${id}';`;
}

function die(msg, code = 1) {
  console.error(`[box-command] ${msg}`);
  process.exit(code);
}

function parseArgv(argv) {
  const opts = { expires: DEFAULT_EXPIRES, wait: false, dryRun: false, script: null, key: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait') opts.wait = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--expires' || a === '--script' || a === '--key') {
      if (argv[i + 1] === undefined) die(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { opts, pos };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id) {
  for (;;) {
    await sleep(5000);
    let rows;
    try {
      rows = await runSql(statusSql(id), { readOnly: true });
    } catch (e) {
      console.error(`[box-command] poll failed, retrying: ${String(e?.message || e).slice(0, 200)}`);
      continue;
    }
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) die(`command ${id} is not in ai_box_commands`);
    const now = Date.now();
    if (TERMINAL.includes(r.status)) {
      console.log(JSON.stringify({ id, status: r.status, started_at: r.started_at, finished_at: r.finished_at, result: r.result }, null, 2));
      process.exit(r.status === 'done' ? 0 : 1);
    }
    if (r.status === 'queued' && now > Date.parse(r.expires_at) + 120000) {
      die(`the box did not pick up ${id} before it expired (is its agent running?)`, 2);
    }
    if (r.status === 'running' && r.started_at && now > Date.parse(r.started_at) + 15 * 60000) {
      die(`${id} is still running after 15 minutes; stopped waiting (the row will still be updated by the box)`, 3);
    }
  }
}

async function main() {
  const { opts, pos } = parseArgv(process.argv.slice(2));
  const [box, verb, json] = pos;
  if (!box || !verb || pos.length > 3) {
    die('usage: node box-command.mjs <box> <verb> [json-args] [--expires 30m] [--wait] [--script <file>] [--key <pem>] [--dry-run]');
  }
  let args = {};
  if (json !== undefined) {
    try {
      args = JSON.parse(json);
    } catch {
      die('json-args is not valid JSON');
    }
  }
  if (opts.script) {
    if (verb !== 'run-script') die('--script is only for run-script');
    let bytes;
    try {
      bytes = readFileSync(opts.script);
    } catch {
      die(`cannot read ${opts.script}`);
    }
    args = { shell: 'powershell', timeout_s: 120, ...args, content_b64: bytes.toString('base64') };
  }
  let cmd;
  try {
    cmd = buildCommand({ box, verb, args, expiresMs: parseExpires(opts.expires) });
  } catch (e) {
    die(e.message);
  }
  const keyPath = opts.key ? resolve(opts.key) : resolve(homedir(), '.jicate-mail', 'box-update-signing.pem');
  let key;
  try {
    key = createPrivateKey(readFileSync(keyPath));
  } catch (e) {
    die(`cannot read the private key at ${keyPath}: ${String(e?.message || e).slice(0, 120)}`);
  }
  let signature;
  try {
    signature = signPayload(cmd.payload, key);
  } catch (e) {
    die(e.message);
  }
  // Same check the box makes, with the public half of the same key.
  if (!verify(null, Buffer.from(cmd.payload, 'utf8'), createPublicKey(key), Buffer.from(signature, 'base64'))) {
    die('signature did not verify locally; not sending');
  }
  const row = {
    id: cmd.id,
    box: cmd.box,
    verb: cmd.verb,
    payload: cmd.payload,
    signature,
    expires_at: cmd.expires_at,
    created_by: `box-command.mjs ${userInfo().username}@${hostname()}`
  };
  if (opts.dryRun) {
    console.log(JSON.stringify({ row, sql: insertSql(row) }, null, 2));
    return;
  }
  try {
    await runSql(insertSql(row));
  } catch (e) {
    die(`insert failed: ${String(e?.message || e).slice(0, 300)}`);
  }
  console.log(`queued ${cmd.id} for ${cmd.box}: ${cmd.verb}, expires ${cmd.expires_at}`);
  if (opts.wait) await waitFor(cmd.id);
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] || '')).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
