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

function runShim(args: string[], input: string, env: Record<string, string> = {}, cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [SHIM, ...args], {
      cwd,
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

// The Box 1 fence (user settings off, dontAsk, read-only list); prompt on stdin.
const FENCE = ['--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--tools', 'Read,Grep,Glob'];
const ARGS = ['-p', '--model', 'sonnet', '--append-system-prompt', 'a "quoted" arg', '--output-format', 'json', ...FENCE, '--allowedTools', 'Read(./**)'];

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
    const sh = spawn('sh', ['-c', `"${process.execPath}" "${SHIM}" -p ${FENCE.join(' ')} --allowedTools "Read(./**)"; true`], {
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

  it('hands no Tower key to a run with no --tools list (shell tools loaded): Tower not asked, own sign-in', async () => {
    const r = await runShim(['-p', '--output-format', 'json', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--allowedTools', 'Read(./**)'], 'p');
    expect(r.code).toBe(0);
    expect(lastResult(r.stdout).who).toBe('own');
    expect(asks).toHaveLength(0);
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain('fence: no Tower key (no --tools list)');
  }, 20_000);

  for (const [name, args, reason] of [
    ['Bash allowed', ['-p', ...FENCE, '--allowedTools', 'Read(./**),Bash(git *)'], 'shell, web or unknown tool allowed'],
    ['PowerShell allowed', ['-p', ...FENCE, '--allowedTools', 'Read(./**)', 'PowerShell'], 'shell, web or unknown tool allowed'],
    ['WebFetch allowed', ['-p', ...FENCE, '--allowed-tools=WebFetch'], 'shell, web or unknown tool allowed'],
    ['WebSearch in --tools', ['-p', ...FENCE, '--tools', 'Read(./**),WebSearch', '--allowedTools', 'Read(./**)'], 'shell, web or unknown tool allowed'],
    ['Write allowed', ['-p', ...FENCE, '--allowedTools', 'Read(./**),Write'], 'shell, web or unknown tool allowed'],
    ['bare Read (reaches any folder)', ['-p', ...FENCE, '--allowedTools', 'Read'], 'file tool not scoped to ./'],
    ['Read of an absolute path', ['-p', ...FENCE, '--allowedTools', 'Read(C:/jicate-ai/**)'], 'file tool not scoped to ./'],
    ['permissions bypassed', ['-p', ...FENCE, '--allowedTools', 'Read(./**)', '--dangerously-skip-permissions'], 'permission bypass'],
    ['a permission prompt tool', ['-p', ...FENCE, '--allowedTools', 'Read(./**)', '--permission-prompt-tool', 'mcp__x__ok'], 'permission bypass'],
    ['an extra folder', ['-p', ...FENCE, '--allowedTools', 'Read(./**)', '--add-dir', 'C:/jicate-ai'], 'extra folders by argument'],
    ['MCP config', ['-p', ...FENCE, '--allowedTools', 'Read(./**)', '--mcp-config', 'm.json'], 'MCP, plugin or settings by argument'],
    ['allow list alone (Box 1 user settings bypass)', ['-p', '--tools', 'Read', '--allowedTools', 'Read(./**)'], 'no --setting-sources without user'],
    ['Bash loaded by --tools', ['-p', ...FENCE, '--tools', 'Read,Bash'], 'shell, web or unknown tool allowed'],
    ['a path rule in --tools', ['-p', ...FENCE.slice(0, 5), '--tools', 'Read(./**)'], 'bad --tools entry'],
    ['user settings loaded', ['-p', '--setting-sources', 'user,project', '--permission-mode', 'dontAsk', '--allowedTools', 'Read(./**)'], 'user settings loaded'],
    ['no permission mode', ['-p', '--setting-sources', 'project', '--tools', 'Read', '--allowedTools', 'Read(./**)'], 'no --permission-mode'],
    ['no --strict-mcp-config', ['-p', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--tools', 'Read', '--allowedTools', 'Read(./**)'], 'no --strict-mcp-config'],
    ['the fence hidden as an option value', ['-p', '--system-prompt', '--setting-sources=project', '--permission-mode=dontAsk', '--strict-mcp-config', '--allowedTools=Read(./**)'], 'option value looks like a flag'],
    ['the fence after "--"', ['-p', '--', ...FENCE, '--allowedTools', 'Read(./**)'], 'no --tools list']
  ] as [string, string[], string][]) {
    it(`hands no Tower key when ${name}`, async () => {
      const r = await runShim(args, 'p');
      expect(lastResult(r.stdout).who).toBe('own');
      expect(asks).toHaveLength(0);
      expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain(`fence: no Tower key (${reason})`);
    }, 20_000);
  }

  it('hands no Tower key when the token file is inside the working folder', async () => {
    const r = await runShim(ARGS, 'p', {}, dir); // dir holds maxlane-test.env
    expect(lastResult(r.stdout).who).toBe('own');
    expect(asks).toHaveLength(0);
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain('fence: no Tower key (token file inside the working folder)');
  }, 20_000);

  it('hands no Tower key when ANTHROPIC_BASE_URL is set', async () => {
    const r = await runShim(ARGS, 'p', { ANTHROPIC_BASE_URL: 'https://elsewhere.example.com' });
    expect(lastResult(r.stdout).who).toBe('own');
    expect(asks).toHaveLength(0);
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain('fence: no Tower key (ANTHROPIC_BASE_URL set)');
  }, 20_000);

  it('an empty tool list (no tools at all, like the JICATE drain) still gets a Tower key', async () => {
    const r = await runShim(['-p', '--output-format', 'json', ...FENCE, '--allowedTools', ''], 'p');
    expect(lastResult(r.stdout).who).toBe('aimech');
    expect(asks).toHaveLength(1);
  }, 20_000);

  it('refuses a plain-http Tower URL that is not localhost', async () => {
    writeFileSync(join(dir, 'http.env'), 'JICATE_AI_URL=http://tower.example.com\nJICATE_AI_RUNNER_TOKEN=' + LANE_TOKEN + '\n');
    const r = await runShim(ARGS, 'p', { TOWER_LANE_ENV: join(dir, 'http.env') });
    expect(lastResult(r.stdout).who).toBe('own');
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toContain('tower: refused a non-https JICATE_AI_URL');
  }, 20_000);

  it('never writes a key to any file', async () => {
    await runShim(ARGS, 'p', { FAKE_LIMITED: 'aimech' });
    expect(existsSync(join(dir, 'logs', 'claude-acct.log'))).toBe(true);
    for (const f of filesUnder(dir)) {
      const text = readFileSync(f, 'utf8');
      for (const k of Object.values(KEYS)) expect(text.includes(k), f).toBe(false);
    }
  }, 20_000);
});

describe('fenceOf (which runs may get a Tower key)', async () => {
  const { fenceOf, envFenceOf, towerUrlOk } = await import('../windows/jicate-ai-engine/claude-acct.mjs');
  const ok = (a: string[]) => fenceOf([...FENCE, ...a]).ok;
  const why = (a: string[]) => fenceOf([...FENCE, ...a]).reason;
  it('allows the Box 1 fence with ./-scoped read-only tools, and "=" forms', () => {
    expect(ok(['-p', '--model', 'sonnet', '--output-format', 'json', '--max-turns', '5', '--allowedTools', 'Read(./**)'])).toBe(true);
    expect(ok(['--allowedTools', 'Read(./**)', 'Grep(./**),Glob(./jobs/**)', 'TodoWrite'])).toBe(true);
    expect(ok(['--tools=Read,Grep', '-p'])).toBe(true);
    expect(ok(['--tools', ''])).toBe(true); // no tools at all
    expect(ok(['--allowedTools', ''])).toBe(true);
    expect(fenceOf(['--setting-sources=project,local', '--permission-mode=plan', '--strict-mcp-config', '--tools', 'Read', '--allowedTools', 'Read(./**)']).ok).toBe(true);
    expect(fenceOf(['--setting-sources', '', '--permission-mode', 'default', '--strict-mcp-config', '--tools', 'Read,Grep']).ok).toBe(true);
    // W12's shape: shell tools never loaded, Read confined to the folder
    expect(fenceOf(['-p', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read(./**)']).ok).toBe(true);
    expect(ok(['--allowedTools', 'Read(./**)', '--', '--dangerously-skip-permissions'])).toBe(true); // prompt text after --
  });
  it('refuses shell, web, write, MCP, agent, "default" and unknown tools', () => {
    for (const t of ['Bash', 'Bash(git *)', 'PowerShell', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'NotebookEdit', 'mcp__x__y', 'Task', 'Agent', 'default', '*', 'BashOutput'])
      expect(ok(['--allowedTools', 'Read(./**)', t]), t).toBe(false);
  });
  it('refuses bare, absolute, home and ../ file-tool rules', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'Read(C:/**)', 'Read(//c/jicate-ai/**)', 'Read(/**)', 'Read(~/**)', 'Read(./../**)', 'Read(**)', 'Read(.\\**)'])
      expect(why(['--allowedTools', t]), t).toBe('file tool not scoped to ./');
  });
  it('a prompt after the tool list reads as a tool (as claude does) and fails safe', () => {
    expect(ok(['-p', '--allowedTools', 'Read(./**)', 'summarise this'])).toBe(false);
  });
  it('an allow list alone is not a fence (Box 1 user settings default to bypassPermissions)', () => {
    expect(fenceOf(['-p']).reason).toBe('no --tools list');
    // a full fence but no --tools: Bash / PowerShell stay loaded -> no key
    expect(fenceOf(['--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--allowedTools', 'Read(./**)']).reason).toBe('no --tools list');
    expect(fenceOf(['-p', '--tools', 'Read', '--allowedTools', 'Read(./**)']).reason).toBe('no --setting-sources without user');
    expect(fenceOf(['--setting-sources', 'project', '--tools', 'Read']).reason).toBe('no --permission-mode');
    expect(fenceOf(['--setting-sources', 'project', '--permission-mode', 'dontAsk', '--tools', 'Read']).reason).toBe('no --strict-mcp-config');
    expect(fenceOf(['--setting-sources', 'project,user', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--tools', 'Read']).reason).toBe('user settings loaded');
  });
  it('--tools takes plain safe names only', () => {
    for (const t of ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'mcp__x__y', 'default', 'Task'])
      expect(why(['--tools', `Read,${t}`]), t).toBe('shell, web or unknown tool allowed');
    expect(why(['--tools', 'Read(./**)'])).toBe('bad --tools entry');
  });
  it('refuses bypass modes, prompt tools, extra folders, settings / plugins / MCP by argument', () => {
    expect(why(['--permission-mode', 'bypassPermissions', '--allowedTools', 'Read(./**)'])).toBe('permission bypass');
    expect(why(['--permission-mode=auto', '--allowedTools', 'Read(./**)'])).toBe('permission bypass');
    expect(why(['--permission-mode', 'acceptEdits', '--allowedTools', 'Read(./**)'])).toBe('permission bypass');
    expect(why(['--allowedTools', 'Read(./**)', '--allow-dangerously-skip-permissions'])).toBe('permission bypass');
    expect(why(['--allowedTools', 'Read(./**)', '--permission-prompt-tool', 'mcp__x'])).toBe('permission bypass');
    expect(why(['--allowedTools', 'Read(./**)', '--add-dir', 'C:/'])).toBe('extra folders by argument');
    for (const f of ['--settings', '--plugin-dir', '--plugin-url', '--mcp-config']) expect(ok(['--allowedTools', 'Read(./**)', f, 'x']), f).toBe(false);
  });
  it('parses like claude: a flag hidden as a value, after "--", or unknown fails safe', () => {
    const hidden = ['--setting-sources=project', '--permission-mode=dontAsk', '--strict-mcp-config', '--allowedTools=Read(./**)'];
    expect(fenceOf(['-p', '--system-prompt', ...hidden]).ok).toBe(false);
    expect(fenceOf(['-p', '--append-system-prompt', ...hidden]).ok).toBe(false);
    expect(fenceOf(['-p', '--model', ...hidden]).ok).toBe(false);
    expect(fenceOf(['-p', '--', ...hidden]).ok).toBe(false);
    expect(why(['--allowedTools', 'Read(./**)', '--frobnicate'])).toBe('unknown or unsafe option');
    expect(why(['--allowedTools', 'Read(./**)', '-pc'])).toBe('unknown or unsafe option');
    expect(why(['--allowedTools', 'Read(./**)', '--chrome'])).toBe('unknown or unsafe option');
  });
  const BASE = ['-p', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config'];
  it('refuses an empty --tools before a flag (claude would take --strict-mcp-config as a tool name)', () => {
    expect(fenceOf(['-p', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--tools', '--strict-mcp-config']).reason)
      .toBe('option value looks like a flag');
    expect(fenceOf([...BASE, '--tools']).ok).toBe(false); // missing value at the end
  });
  it('refuses an empty --allowedTools before a flag (it would swallow --setting-sources: user bypass settings load)', () => {
    expect(fenceOf(['-p', '--tools', 'Read,Grep,Glob', '--allowedTools', '--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config']).reason)
      .toBe('option value looks like a flag');
    expect(fenceOf([...BASE, '--tools', 'Read', '--allowedTools']).ok).toBe(false);
    // W12's proven case: two swallows in one list
    expect(fenceOf(['--tools', 'Read,Grep,Glob', '--allowedTools', '--setting-sources', 'project', '--disallowedTools', '--permission-mode', 'dontAsk', '--strict-mcp-config']).ok)
      .toBe(false);
  });
  it('refuses an empty --disallowedTools before a flag (it would swallow --permission-mode)', () => {
    expect(fenceOf(['-p', '--tools', 'Read', '--setting-sources', 'project', '--disallowedTools', '--permission-mode', 'dontAsk', '--strict-mcp-config']).reason)
      .toBe('option value looks like a flag');
  });
  it('PowerShell 5.1 dropping "" (--tools "" --strict-mcp-config) is refused; the real empty forms still pass', () => {
    expect(fenceOf([...BASE.slice(0, 5), '--tools', '--strict-mcp-config']).ok).toBe(false);
    expect(fenceOf([...BASE, '--tools', '']).ok).toBe(true);
    expect(fenceOf([...BASE, '--tools=']).ok).toBe(true);
    expect(fenceOf([...BASE, '--tools', '', '--disallowedTools', 'Bash']).ok).toBe(true);
  });
  it('the reason never carries argument text', () => {
    expect(JSON.stringify(fenceOf([...FENCE, '--allowedTools', 'SECRET_TOOL_NAME']))).not.toContain('SECRET');
    expect(JSON.stringify(fenceOf([...FENCE, '--SECRET-flag']))).not.toContain('SECRET');
  });
  it('spots the token file inside (or equal to) the working folder, case-insensitive on Windows', async () => {
    const { tokenInsideFolder } = await import('../windows/jicate-ai-engine/claude-acct.mjs');
    const env = 'C:\\jicate-ai\\maxlane-biometric.env';
    expect(tokenInsideFolder(env, 'C:\\jicate-ai', 'win32')).toBe(true);
    expect(tokenInsideFolder(env, 'c:\\JICATE-AI', 'win32')).toBe(true);
    expect(tokenInsideFolder(env, 'C:\\', 'win32')).toBe(true);
    expect(tokenInsideFolder(env, 'C:\\jkkn-cards\\jobs', 'win32')).toBe(false);
    expect(tokenInsideFolder(env, 'C:\\jicate-ai-jobs', 'win32')).toBe(false);
    expect(tokenInsideFolder('\\\\?\\C:\\jicate-ai\\maxlane-biometric.env', 'C:\\jicate-ai', 'win32')).toBe(true);
    expect(tokenInsideFolder(env, '\\\\?\\c:\\JICATE-AI', 'win32')).toBe(true);
    expect(tokenInsideFolder('C:\\..lane\\token.env', 'C:\\', 'win32')).toBe(true); // a folder named "..lane" is inside
    expect(tokenInsideFolder('/srv/lane/token.env', '/srv', 'linux')).toBe(true);
    expect(tokenInsideFolder('/srv/lane/token.env', '/srv/jobs', 'linux')).toBe(false);
  });

  it('resolves links on this machine with the native realpath (another spelling cannot hide the folder)', async () => {
    const { tokenInsideFolder } = await import('../windows/jicate-ai-engine/claude-acct.mjs');
    const { mkdtempSync, mkdirSync, symlinkSync } = await import('node:fs');
    const d = mkdtempSync(join(tmpdir(), 'tk-'));
    mkdirSync(join(d, 'real'));
    symlinkSync(join(d, 'real'), join(d, 'link'));
    expect(tokenInsideFolder(join(d, 'link', 'x.env'), join(d, 'real'))).toBe(true);
    expect(tokenInsideFolder(join(d, 'real', 'x.env'), join(d, 'link'))).toBe(true);
    expect(tokenInsideFolder(join(d, 'real', 'x.env'), d)).toBe(true);
    mkdirSync(join(d, 'jobs'));
    expect(tokenInsideFolder(join(d, 'real', 'x.env'), join(d, 'jobs'))).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it('refuses a key when ANTHROPIC_BASE_URL is set', () => {
    expect(envFenceOf({ ANTHROPIC_BASE_URL: 'https://x.example.com' })).toEqual({ ok: false, reason: 'ANTHROPIC_BASE_URL set' });
    expect(envFenceOf({}).ok).toBe(true);
  });
  it('accepts https, and plain http only for localhost', () => {
    expect(towerUrlOk('https://tower.example.com')).toBe(true);
    expect(towerUrlOk('http://127.0.0.1:3000')).toBe(true);
    expect(towerUrlOk('http://localhost:3000')).toBe(true);
    expect(towerUrlOk('http://tower.example.com')).toBe(false);
    expect(towerUrlOk('http://localhost.example.com')).toBe(false);
    expect(towerUrlOk('not a url')).toBe(false);
  });
});
