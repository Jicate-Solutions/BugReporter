#!/usr/bin/env node
// Make this computer's mailbox key. Run once per computer.
//
//   node new-mail-token.mjs <box-name> <control-tower-url>
//   e.g. node new-mail-token.mjs win-ai https://jkkn-centralized-bug-reporter.vercel.app
//
// Writes ~/.jicate-mail/config.json (readable by this user only) and prints ONE
// line: box=<name> sha256=<fingerprint>. Send only that line to be registered.
// The key itself never leaves this computer and is never printed.
// Refuses to overwrite an existing key. Pure ASCII on purpose.

import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [name, url] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(name || '') || !/^https:\/\/[^\s/]+/.test(url || '')) {
  console.error('usage: node new-mail-token.mjs <box-name a-z0-9-> <https://control-tower-url>');
  process.exit(1);
}

const dir = join(homedir(), '.jicate-mail');
const file = join(dir, 'config.json');
if (existsSync(file)) {
  console.error(`[jicate-mail] ${file} already exists; not overwriting. Delete it yourself to make a new key.`);
  process.exit(1);
}

const token = randomBytes(32).toString('base64url');
mkdirSync(dir, { recursive: true });
writeFileSync(file, JSON.stringify({ box: name, url: url.replace(/\/+$/, ''), token }, null, 2), { mode: 0o600 });
if (platform() === 'win32') {
  // Owner-only access on Windows: drop inherited rights, grant this user.
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${userInfo().username}:F`], { stdio: 'ignore' });
} else {
  chmodSync(dir, 0o700);
  chmodSync(file, 0o600);
}

console.log(`box=${name} sha256=${createHash('sha256').update(token, 'utf8').digest('hex')}`);
