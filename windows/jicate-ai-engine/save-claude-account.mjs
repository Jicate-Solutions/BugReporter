#!/usr/bin/env node
// Save one extra Claude account's long-lived key for the JICATE workers.
//
// 1. In a normal PowerShell window (not a Claude tab), run:  claude setup-token
//    Sign in to the extra Claude account in the browser it opens, then copy
//    the key it prints.
// 2. Run:  node save-claude-account.mjs <label>       e.g. acct2
//    Paste the key when asked (it is not shown), then press Enter.
//
// Saves <this folder>\accounts\<label>.token, readable by this Windows user
// only, then checks it with one tiny Claude call. The key is never printed,
// logged or sent anywhere; the workers report only the label to the Control
// Tower, where an admin picks which label each worker uses.
// Refuses to overwrite an existing label. Pure ASCII on purpose.

import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, userInfo, tmpdir } from 'node:os';
import { execFileSync, execFile } from 'node:child_process';

const label = process.argv[2] || '';
if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(label) || label === 'default' || label === 'auto') {
  console.error('usage: node save-claude-account.mjs <label>   (a-z 0-9 -, not "default" or "auto")');
  process.exit(1);
}
const dir = process.env.ACCOUNTS_DIR || resolve(dirname(fileURLToPath(import.meta.url)), 'accounts');
const file = join(dir, `${label}.token`);
if (existsSync(file)) {
  console.error(`[accounts] ${file} already exists; not overwriting. Delete it yourself to replace it.`);
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((done) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', function onData(ch) {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return done(value.trim());
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    });
  });
}

const key = await askHidden(`Paste the key for "${label}" (hidden), then Enter: `);
if (key.length < 20) {
  console.error('[accounts] that does not look like a key; nothing saved.');
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
writeFileSync(file, key, { mode: 0o600 });
if (platform() === 'win32') {
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${userInfo().username}:F`], { stdio: 'ignore' });
} else {
  chmodSync(file, 0o600);
}

// One tiny call on that account, from an empty folder, no tools.
const sandbox = join(tmpdir(), 'jicate-ai-sandbox');
mkdirSync(sandbox, { recursive: true });
const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: key };
const bin = process.env.CLAUDE_BIN || 'claude';
execFile(
  bin,
  ['-p', '--model', 'haiku', '--output-format', 'json', '--strict-mcp-config',
   '--no-session-persistence', '--disable-slash-commands', '--allowedTools', ''],
  { cwd: sandbox, env, timeout: 120_000, windowsHide: true },
  (err, stdout) => {
    let d = null;
    try { d = JSON.parse(stdout); } catch { /* below */ }
    if (d && !d.is_error) {
      console.log(`account=${label} saved and works`);
      return;
    }
    const why = String(d?.result || err?.message || 'no answer').slice(0, 160);
    unlinkSync(file);
    console.error(`[accounts] the key did not work (${why}); nothing kept. Run claude setup-token again.`);
    process.exit(1);
  },
).stdin.end('Reply with exactly: ok');
