#!/usr/bin/env node
// Sign a worker file for the box agent's file updates (runs on the Mac, never
// on a box). Pure ASCII on purpose.
//
//   node sign-box-file.mjs <path/to/jicate-ai-drain.mjs> [--key <private.pem>]
//     prints {"name","sha256","signature"} for the Box desk to upsert into
//     ai_box_files together with content (the file's exact text) and source
//     (the commit sha).
//   node sign-box-file.mjs --keygen [--key <private.pem>]
//     makes a new Ed25519 key pair: the private key goes to <private.pem>
//     (mode 0600, refuses to overwrite), and ONLY the public key is printed,
//     as base64 SPKI DER, for "updatePublicKey" in each box's box-agent.json.
//
// Default private key: ~/.jicate-mail/box-update-signing.pem. The private key
// is never printed and must never be committed.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

const FILES = ['jicate-ai-drain.mjs']; // same allow-list as the agent and ai_box_files

const args = process.argv.slice(2);
const k = args.indexOf('--key');
const keyPath = k >= 0 && args[k + 1] ? resolve(args[k + 1]) : resolve(homedir(), '.jicate-mail', 'box-update-signing.pem');
const rest = args.filter((a, i) => !(i === k || i === k + 1));

function die(msg) {
  console.error(`[sign-box-file] ${msg}`);
  process.exit(1);
}

if (rest[0] === '--keygen') {
  if (existsSync(keyPath)) die(`${keyPath} already exists; not overwriting it`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
} else {
  const file = rest[0];
  if (!file) die('usage: node sign-box-file.mjs <file> [--key <private.pem>] | --keygen [--key <private.pem>]');
  const name = basename(file);
  if (!FILES.includes(name)) die(`${name} is not a file the box agent may install (allowed: ${FILES.join(', ')})`);
  let key;
  try {
    key = createPrivateKey(readFileSync(keyPath));
  } catch (e) {
    die(`cannot read the private key at ${keyPath}: ${String(e?.message || e).slice(0, 120)}`);
  }
  if (key.asymmetricKeyType !== 'ed25519') die('the private key is not Ed25519');
  // Sign the bytes of the file's text as UTF-8: that is what the agent receives
  // (ai_box_files.content) and hashes. Same as the raw bytes for a UTF-8 file.
  const bytes = Buffer.from(readFileSync(file, 'utf8'), 'utf8');
  if (!bytes.equals(readFileSync(file))) die(`${name} is not valid UTF-8 text`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = sign(null, bytes, key).toString('base64');
  console.log(JSON.stringify({ name, sha256, signature }));
}
