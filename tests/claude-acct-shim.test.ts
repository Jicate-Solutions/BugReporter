import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * windows/jicate-ai-engine/claude-acct.mjs end to end, with a fake claude and
 * a fake Tower: arguments and stdin reach claude unchanged; the key is only in
 * the child's environment; a refused account rolls to the next once; only the
 * last run's output reaches the drain; the Tower being down runs as before; the
 * key is never written to any file.
 */

const SHIM = resolve(__dirname, '../windows/jicate-ai-engine/claude-acct.mjs');
const KEYS: Record<string, string> = {
  aimech: 'sk-ant-oat01-' + 'M'.repeat(40),
  ainursing: 'sk-ant-oat01-' + 'N'.repeat(40),
  aiahs: 'sk-ant-oat01-' + 'H'.repeat(40)
};
const ORDER = ['aimech', 'ainursing', 'aiahs'];
const LANE_TOKEN = 'T'.repeat(64);

let dir = '';
let server: Server;
let url = '';
const asks: { refused: string | null; auth: string | null }[] = [];

const FAKE_CLAUDE = `#!/usr/bin/env node
const require = (await import('node:module')).createRequire(import.meta.url);
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const key = process.env.CLAUDE_CODE_OAUTH_TOKEN || 'own';
  const limited = (process.env.FAKE_LIMITED || '').split(',').filter(Boolean);
  const who = Object.entries(JSON.parse(process.env.FAKE_KEYS)).find(([, k]) => k === key)?.[0] || key;
  console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }));
  if (process.env.FAKE_HANG) {
    require('fs').writeFileSync(process.env.FAKE_HANG, String(process.pid));
    setInterval(() => {}, 1000);
    return;
  }
  if (process.env.FAKE_OTHER_FAIL) {
    console.log(JSON.stringify({ type: 'assistant', text: 'the API said 429 rate limit earlier, then a tool broke' }));
    console.log(JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: 'max turns reached' }));
    process.exit(1);
  }
  if (limited.includes(who)) {
    console.log(JSON.stringify({ type: 'result', is_error: true, result: "You've hit your limit · resets 3pm" }));
    process.stderr.write('limit for ' + who + '\\n');
    process.exit(1);
  }
  console.log(JSON.stringify({ type: 'result', is_error: false,
    result: 'usage limit is a phrase in this good answer',
    who, args: process.argv.slice(2), stdin: Buffer.concat(chunks).toString() }));
});
`;

function runShim(args: string[], input: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [SHIM, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        CLAUDE_REAL_BIN: join(dir, 'fake-claude.mjs'),
        TOWER_LANE_ENV: join(dir, 'maxlane-test.env'),
        CLAUDE_ACCT_LOG: join(dir, 'logs', 'claude-acct.log'),
        FAKE_KEYS: JSON.stringify(KEYS),
        ...env
      } as unknown as NodeJS.ProcessEnv
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function filesUnder(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'claude-acct-'));
  writeFileSync(join(dir, 'fake-claude.mjs'), FAKE_CLAUDE);
  chmodSync(join(dir, 'fake-claude.mjs'), 0o755);
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    asks.push({ refused: u.searchParams.get('refused'), auth: req.headers.authorization ?? null });
    if (req.headers.authorization !== `Bearer ${LANE_TOKEN}`) {
      res.writeHead(401).end('{}');
      return;
    }
    const refused = (u.searchParams.get('refused') ?? '').split(',').filter(Boolean);
    const next = ORDER.find((l) => !refused.includes(l));
    if (!next) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NO_ACCOUNT_LEFT', retry_after_seconds: 600 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ label: next, key: KEYS[next] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  writeFileSync(join(dir, 'maxlane-test.env'), `JICATE_AI_URL=${url}\nJICATE_AI_RUNNER_TOKEN=${LANE_TOKEN}\n`);
});

afterAll(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  asks.length = 0;
});

const ARGS = ['-p', '--model', 'sonnet', '--output-format', 'json', '--allowedTools', 'Read', 'a "quoted" arg'];

function lastResult(stdout: string) {
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

describe('claude-acct.mjs', () => {
  it('runs on the Tower account with arguments and stdin unchanged', async () => {
    const r = await runShim(ARGS, 'the prompt\nline 2');
    expect(r.code).toBe(0);
    const out = lastResult(r.stdout);
    expect(out.who).toBe('aimech');
    expect(out.args).toEqual(ARGS);
    expect(out.stdin).toBe('the prompt\nline 2');
    expect(asks).toEqual([{ refused: null, auth: `Bearer ${LANE_TOKEN}` }]);
  }, 20_000);

  it('a good answer that mentions "usage limit" is not a refusal', async () => {
    const r = await runShim(ARGS, 'x');
    expect(lastResult(r.stdout).is_error).toBe(false);
    expect(asks).toHaveLength(1);
  }, 20_000);

  it('rolls to the next account once when Claude refuses, and returns only the last run', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_LIMITED: 'aimech' });
    expect(r.code).toBe(0);
    expect(lastResult(r.stdout).who).toBe('ainursing');
    expect(r.stdout).not.toContain('hit your limit');
    expect(r.stderr).not.toContain('limit for aimech');
    expect(asks.map((a) => a.refused)).toEqual([null, 'aimech']);
  }, 20_000);

  it('tries each account at most once, then the own sign-in once, then hands back the refusal', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_LIMITED: 'aimech,ainursing,aiahs,own' });
    expect(r.code).toBe(1);
    expect(asks.map((a) => a.refused)).toEqual([null, 'aimech', 'aimech,ainursing', 'aimech,ainursing,aiahs']);
    expect(r.stdout).toContain('hit your limit');
    expect(r.stderr).toContain('limit for own');
    const log = readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8');
    expect(log).toMatch(/attempt=4 account=own-sign-in exit=1 refused=limit/);
  }, 30_000);

  it('runs exactly as before when the Tower cannot be reached', async () => {
    writeFileSync(join(dir, 'down.env'), 'JICATE_AI_URL=http://127.0.0.1:9\nJICATE_AI_RUNNER_TOKEN=' + LANE_TOKEN + '\n');
    const r = await runShim(ARGS, 'p', { TOWER_LANE_ENV: join(dir, 'down.env') });
    expect(r.code).toBe(0);
    expect(lastResult(r.stdout).who).toBe('own');
  }, 30_000);

  it('CLAUDE_ACCT_OFF=1 skips the Tower', async () => {
    const r = await runShim(ARGS, 'p', { CLAUDE_ACCT_OFF: '1' });
    expect(lastResult(r.stdout).who).toBe('own');
    expect(asks).toHaveLength(0);
  }, 20_000);

  it('refuses to run itself as the real claude', async () => {
    const r = await runShim(ARGS, 'p', { CLAUDE_REAL_BIN: SHIM });
    expect(r.code).toBe(2);
    expect(asks).toHaveLength(0);
  }, 20_000);

  it('a run that failed for another reason does not roll, even if its transcript mentions 429', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_OTHER_FAIL: '1' });
    expect(r.code).toBe(1);
    expect(asks).toHaveLength(1);
    expect(lastResult(r.stdout).subtype).toBe('error_max_turns');
  }, 20_000);

  it('stops claude when the process that started the shim is killed', async () => {
    const pidFile = join(dir, 'hang.pid');
    // sh is the "drain-side" parent (like cmd.exe or claude-acct.exe on Windows);
    // "; true" stops sh from exec-ing node in its place.
    const sh = spawn('sh', ['-c', `"${process.execPath}" "${SHIM}" -p; true`], {
      env: {
        PATH: process.env.PATH ?? '',
        CLAUDE_REAL_BIN: join(dir, 'fake-claude.mjs'),
        TOWER_LANE_ENV: join(dir, 'maxlane-test.env'),
        CLAUDE_ACCT_LOG: join(dir, 'logs', 'claude-acct.log'),
        CLAUDE_ACCT_PARENT_POLL_MS: '200',
        FAKE_KEYS: JSON.stringify(KEYS),
        FAKE_HANG: pidFile
      } as unknown as NodeJS.ProcessEnv,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    sh.stdin.end('p');
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let claudePid = 0;
    for (let i = 0; i < 100 && !claudePid; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (existsSync(pidFile)) claudePid = Number(readFileSync(pidFile, 'utf8'));
    }
    expect(claudePid).toBeGreaterThan(0);
    expect(alive(claudePid)).toBe(true);
    sh.kill('SIGKILL');
    for (let i = 0; i < 50 && alive(claudePid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(claudePid)).toBe(false);
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain('parent gone: stopping claude');
  }, 30_000);

  it('never writes a key to any file', async () => {
    await runShim(ARGS, 'p', { FAKE_LIMITED: 'aimech' });
    expect(existsSync(join(dir, 'logs', 'claude-acct.log'))).toBe(true);
    for (const f of filesUnder(dir)) {
      const text = readFileSync(f, 'utf8');
      for (const k of Object.values(KEYS)) expect(text.includes(k), f).toBe(false);
    }
  }, 20_000);
});
