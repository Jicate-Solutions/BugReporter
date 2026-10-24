#!/usr/bin/env node
// Sign a file for the box agent's file updates (runs on the Mac, never on a
// box). Pure ASCII on purpose.
//
//   node sign-box-file.mjs <path/to/file> [--key <private.pem>] [--publish [--source <commit sha>]]
//     prints {"name","sha256","signature"}. With --publish it also upserts the
//     row into public.ai_box_files (name, sha256, signature, content = the
//     file's exact text, source = the commit sha, updated_at = now()) through
//     the Supabase Management API (token: ~/.supabase/access-token, never
//     printed). Without --source the source is `git rev-parse HEAD`, and the
//     file must have no uncommitted changes.
//   node sign-box-file.mjs --keygen [--key <private.pem>]
//     makes a new Ed25519 key pair: the private key goes to <private.pem>
//     (mode 0600, refuses to overwrite), and ONLY the public key is printed,
//     as base64 SPKI DER, for "updatePublicKey" in each box's box-agent.json.
//
// Text and bytes: content is the file's text; sha256 and signature are over
// the UTF-8 bytes of that text. Every file must be UTF-8, except the task
// XMLs (*.xml), which Windows writes as UTF-16LE with a BOM: those must be
// UTF-16LE with a BOM, are decoded to text here, and the agent writes them
// back to disk as BOM + UTF-16LE (their declaration says encoding="UTF-16").
// Launchers (*.cmd) must use CRLF on every line; the agent refuses others.
//
// Default private key: ~/.jicate-mail/box-update-signing.pem. The private key
// is never printed and must never be committed.

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { jsonbLiteral, runSql } from './tower-sql.mjs';

// Same allow-list as the agent, lib/ai-engine/box-files.ts and the CHECK on ai_box_files.name.
export const FILES = [
  'jicate-ai-drain.mjs',
  'jicate-box-agent.mjs',
  'jicate-mail.mjs',
  'run-jicate-ai-drain.cmd',
  'run-jicate-box-agent.cmd',
  'ai.jicate.engine-1.xml',
  'ai.jicate.engine-2.xml',
  'ai.jicate.engine-3.xml',
  'ai.jicate.engine-4.xml',
  'ai.jicate.box-agent.xml'
];

const BOM16LE = Buffer.from([0xff, 0xfe]);

/** The file's text, checked to round-trip exactly to its bytes on disk. */
export function readBoxFileText(file) {
  const name = basename(file);
  const raw = readFileSync(file);
  if (name.endsWith('.xml')) {
    if (!raw.subarray(0, 2).equals(BOM16LE)) throw new Error(`${name} must be UTF-16LE with a BOM (as Windows exports task XML)`);
    const text = raw.subarray(2).toString('utf16le');
    if (!Buffer.concat([BOM16LE, Buffer.from(text, 'utf16le')]).equals(raw)) throw new Error(`${name} is not valid UTF-16LE text`);
    return text;
  }
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error(`${name} is not valid UTF-8 text`);
  if (name.endsWith('.cmd') && !isCrlf(text)) {
    throw new Error(
      `${name} must use Windows line endings (CRLF) on every line; the box agent refuses anything else. ` +
        'Re-checkout it (.gitattributes sets eol=crlf for *.cmd) or convert it, then sign again.'
    );
  }
  return text;
}

/** True when every line break is CRLF (no bare LF, no bare CR). Same rule as the agent. */
export function isCrlf(text) {
  return !/(^|[^\r])\n/.test(text) && !/\r(?!\n)/.test(text);
}

/** { name, sha256, signature, content } for an allow-listed file. */
export function signBoxFile(file, privateKey) {
  const name = basename(file);
  if (!FILES.includes(name)) throw new Error(`${name} is not a file the box agent may install (allowed: ${FILES.join(', ')})`);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('the private key is not Ed25519');
  const content = readBoxFileText(file);
  // Sign the UTF-8 bytes of the text: that is what the agent receives
  // (ai_box_files.content) and hashes.
  const bytes = Buffer.from(content, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = sign(null, bytes, privateKey).toString('base64');
  return { name, sha256, signature, content };
}

export function publishSql(row) {
  return (
    'insert into public.ai_box_files (name, sha256, signature, content, source, updated_at) ' +
    'select name, sha256, signature, content, source, now() ' +
    `from jsonb_populate_record(null::public.ai_box_files, ${jsonbLiteral(row)}) ` +
    'on conflict (name) do update set sha256 = excluded.sha256, signature = excluded.signature, ' +
    'content = excluded.content, source = excluded.source, updated_at = excluded.updated_at ' +
    'returning name, sha256, updated_at;'
  );
}

function die(msg) {
  console.error(`[sign-box-file] ${msg}`);
  process.exit(1);
}

function commitOf(file) {
  const dir = dirname(resolve(file));
  let head, dirty;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain', '--', basename(file)], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    die('cannot read the commit sha from git; pass --source <commit sha>');
  }
  if (dirty) die(`${basename(file)} has uncommitted changes; commit first (or pass --source)`);
  return head;
}

async function main() {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) die(`${flag} needs a value`);
    args.splice(i, 2);
    return v;
  };
  const keyArg = take('--key');
  const sourceArg = take('--source');
  const p = args.indexOf('--publish');
  const publish = p >= 0;
  if (publish) args.splice(p, 1);
  const keyPath = keyArg ? resolve(keyArg) : resolve(homedir(), '.jicate-mail', 'box-update-signing.pem');

  if (args[0] === '--keygen') {
    if (existsSync(keyPath)) die(`${keyPath} already exists; not overwriting it`);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
    return;
  }
  const file = args[0];
  if (!file || args.length > 1) {
    die('usage: node sign-box-file.mjs <file> [--key <private.pem>] [--publish [--source <sha>]] | --keygen [--key <private.pem>]');
  }
  if (sourceArg !== undefined && !/^[0-9a-f]{7,40}$/.test(sourceArg)) die('--source must be a commit sha');
  let key;
  try {
    key = createPrivateKey(readFileSync(keyPath));
  } catch (e) {
    die(`cannot read the private key at ${keyPath}: ${String(e?.message || e).slice(0, 120)}`);
  }
  let signed;
  try {
    signed = signBoxFile(file, key);
  } catch (e) {
    die(e.message);
  }
  const { name, sha256, signature, content } = signed;
  console.log(JSON.stringify({ name, sha256, signature }));
  if (!publish) return;
  const source = sourceArg ?? commitOf(file);
  try {
    await runSql(publishSql({ name, sha256, signature, content, source }));
  } catch (e) {
    die(`publish failed: ${String(e?.message || e).slice(0, 300)}`);
  }
  console.log(`published ${name} ${sha256.slice(0, 8)} (source ${source.slice(0, 12)})`);
}

const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] || '')).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
