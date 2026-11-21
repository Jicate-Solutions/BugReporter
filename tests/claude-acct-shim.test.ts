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
    if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR + '\\n');
    console.log(JSON.stringify({ type: 'assistant', text: 'the API said 429 rate limit earlier, then a tool broke' }));
    console.log(JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: 'max turns reached' }));
    process.exit(1);
  }
  if ((process.env.FAKE_ORG_BLOCKED || '').split(',').filter(Boolean).includes(who)) {
    console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Your organization has disabled Claude subscription access for Claude Code. Ask your organization’s admin.' }));
    process.stderr.write('org block for ' + who + '\\n');
    process.exit(1);
  }
  if (limited.includes(who)) {
    console.log(JSON.stringify({ type: 'result', is_error: true, result: "You've hit your weekly limit · resets Nov 19, 2:30pm (Asia/Kolkata)" }));
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

// proof-read.mjs on Box 1: the settings value is ONE argument holding JSON text.
const PROOF_SETTINGS =
  '{"permissions":{"allow":["Read(./**)"],"deny":["Read(//c/Users/**)","Read(C:/Users/**)","Read(//c/jicate-ai/**)","Read(C:/jicate-ai/**)","Read(~/**)"],"defaultMode":"dontAsk"}}';
/** proof-read's exact arguments, with this --settings value. */
const proofArgs = (settings: string) => [
  '-p', '--model', 'sonnet', '--output-format', 'json', '--setting-sources', 'project',
  '--settings', settings,
  '--permission-mode', 'dontAsk', '--tools', 'Read', '--allowedTools', 'Read(./**)', '--strict-mcp-config', '--disable-slash-commands'
];
const PROOF_ARGS = proofArgs(PROOF_SETTINGS);
const SETTINGS_AT = PROOF_ARGS.indexOf('--settings') + 1;
// The same settings, other spacing and key order: must come out as PROOF_SETTINGS.
const PROOF_SETTINGS_LOOSE = `
  { "permissions" : {
      "defaultMode" : "dontAsk",
      "deny" : [ "Read(//c/Users/**)", "Read(C:/Users/**)", "Read(//c/jicate-ai/**)", "Read(C:/jicate-ai/**)", "Read(~/**)" ],
      "allow" : [ "Read(.\\u002f**)" ]
  } }
`;
const SETTINGS_REASON = 'settings by argument: not the strict shape';

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
    expect(r.stdout).not.toContain('hit your weekly limit');
    expect(r.stderr).not.toContain('limit for aimech');
    expect(asks.map((a) => a.refused)).toEqual([null, 'aimech']);
  }, 20_000);

  it('tries each account at most once, then the own sign-in once, then hands back the refusal', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_LIMITED: 'aimech,ainursing,aiahs,own' });
    expect(r.code).toBe(1);
    expect(asks.map((a) => a.refused)).toEqual([null, 'aimech', 'aimech,ainursing', 'aimech,ainursing,aiahs']);
    expect(r.stdout).toContain('hit your weekly limit');
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

  it('a run that failed for another reason does not roll when its stderr merely mentions "weekly limit"', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_OTHER_FAIL: '1', FAKE_STDERR: 'note: the weekly limit and session limit panels could not be drawn' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('weekly limit');
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

  it("proof-read's exact arguments (strict --settings) get a Tower key, and claude gets the shim's own settings JSON", async () => {
    const r = await runShim(PROOF_ARGS, 'check this proof');
    expect(r.code).toBe(0);
    const out = lastResult(r.stdout);
    expect(out.who).toBe('aimech');
    expect(asks).toHaveLength(1);
    expect(out.stdin).toBe('check this proof');
    expect(out.args[SETTINGS_AT]).toBe(JSON.stringify(JSON.parse(PROOF_SETTINGS)));
    expect(out.args).toEqual(PROOF_ARGS); // nothing else moved
  }, 20_000);

  it('a differently spaced and ordered --settings is forwarded in the same canonical form, never as written', async () => {
    const args = proofArgs(PROOF_SETTINGS_LOOSE);
    const r = await runShim(args, 'p');
    const out = lastResult(r.stdout);
    expect(out.who).toBe('aimech');
    expect(out.args[SETTINGS_AT]).not.toBe(PROOF_SETTINGS_LOOSE);
    expect(out.args[SETTINGS_AT]).toBe(PROOF_SETTINGS);
    expect(out.args).toEqual(PROOF_ARGS);
  }, 20_000);

  it('a rolled run carries the canonical --settings on every account', async () => {
    const r = await runShim(proofArgs(PROOF_SETTINGS_LOOSE), 'p', { FAKE_LIMITED: 'aimech' });
    const out = lastResult(r.stdout);
    expect(out.who).toBe('ainursing');
    expect(out.args[SETTINGS_AT]).toBe(PROOF_SETTINGS);
  }, 20_000);

  it('a fenced run that falls back to the own sign-in (Tower down) still carries the canonical --settings', async () => {
    writeFileSync(join(dir, 'down2.env'), 'JICATE_AI_URL=http://127.0.0.1:9\nJICATE_AI_RUNNER_TOKEN=' + LANE_TOKEN + '\n');
    const r = await runShim(proofArgs(PROOF_SETTINGS_LOOSE), 'p', { TOWER_LANE_ENV: join(dir, 'down2.env') });
    const out = lastResult(r.stdout);
    expect(out.who).toBe('own');
    expect(out.args).toEqual(PROOF_ARGS);
  }, 30_000);

  for (const [name, args] of [
    ['is a file path', proofArgs('C:/jkkn-proof/SECRET-settings.json')],
    ['has a hooks key', proofArgs('{"permissions":{"allow":["Read(./**)"]},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"SECRET-cmd"}]}]}}')],
    ['allows Bash', proofArgs('{"permissions":{"allow":["Read(./**)","Bash(SECRET-cmd:*)"],"defaultMode":"dontAsk"}}')],
    ['is given twice', [...PROOF_ARGS, '--settings', PROOF_SETTINGS]],
    ['sits past "--", where nothing checks it', [...ARGS, '--', '--settings', 'C:/jkkn-proof/SECRET-settings.json']]
  ] as [string, string[]][]) {
    it(`hands no Tower key when --settings ${name}; the run goes on untouched, the value is not logged`, async () => {
      const r = await runShim(args, 'p');
      const out = lastResult(r.stdout);
      expect(out.who).toBe('own');
      expect(out.args).toEqual(args); // an unfenced run is passed on exactly as it came
      expect(asks).toHaveLength(0);
      const log = readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8');
      expect(log).toContain(`fence: no Tower key (${SETTINGS_REASON})`);
      expect(log).not.toContain('SECRET');
    }, 20_000);
  }

  it('a valid --settings does not rescue a run the fence refuses for another reason', async () => {
    const r = await runShim([...PROOF_ARGS, '--mcp-config', 'm.json'], 'p');
    expect(lastResult(r.stdout).who).toBe('own');
    expect(asks).toHaveLength(0);
  }, 20_000);

  it('CLAUDE_ACCT_OFF=1 passes --settings on exactly as written', async () => {
    const args = proofArgs(PROOF_SETTINGS_LOOSE);
    const r = await runShim(args, 'p', { CLAUDE_ACCT_OFF: '1' });
    const out = lastResult(r.stdout);
    expect(out.who).toBe('own');
    expect(out.args).toEqual(args);
    expect(asks).toHaveLength(0);
  }, 20_000);

  it('rolls to the next account when the organisation has disabled Claude Code for the account', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_ORG_BLOCKED: 'aimech' });
    expect(r.code).toBe(0);
    expect(lastResult(r.stdout).who).toBe('ainursing');
    expect(r.stdout).not.toContain('has disabled Claude subscription access');
    expect(r.stderr).not.toContain('org block for aimech');
    expect(asks.map((a) => a.refused)).toEqual([null, 'aimech']);
    expect(readFileSync(join(dir, 'logs', 'claude-acct.log'), 'utf8')).toMatch(/attempt=1 account=aimech exit=1 refused=org/);
  }, 20_000);

  it('a run that failed for another reason does not roll when it merely mentions "organization"', async () => {
    const r = await runShim(ARGS, 'p', { FAKE_OTHER_FAIL: '1', FAKE_STDERR: 'note: your organization has disabled the usage panel; Claude subscription access is fine' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('organization');
    expect(asks).toHaveLength(1);
    expect(lastResult(r.stdout).subtype).toBe('error_max_turns');
  }, 20_000);

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
  describe('strict --settings', async () => {
    const { strictSettings } = await import('../windows/jicate-ai-engine/claude-acct.mjs');
    const J = (o: unknown) => JSON.stringify(o);
    const P = (permissions: unknown) => J({ permissions });
    const GOOD = P({ allow: ['Read(./**)'], deny: ['Read(~/**)'], defaultMode: 'dontAsk' });

    it("takes proof-read's exact arguments and hands back the shim's own JSON in place of the value", () => {
      const f = fenceOf(PROOF_ARGS);
      expect(f).toEqual({ ok: true, args: PROOF_ARGS });
      expect(f.args).not.toBe(PROOF_ARGS); // a copy: the drain's own list is never edited
      const loose = proofArgs(PROOF_SETTINGS_LOOSE);
      expect(fenceOf(loose)).toEqual({ ok: true, args: PROOF_ARGS });
      expect(loose[SETTINGS_AT]).toBe(PROOF_SETTINGS_LOOSE);
    });
    it('takes the settings line proof-read.mjs really builds on Box 1 (13 deny rules, read from the box 21 Nov 2026), byte for byte', () => {
      // C:\Users\Admin\jkkn-max-lane\proof-read.mjs lines 197-200 as they stood on the box. Eight bare tool
      // names sit in front of the five path rules; the value above (PROOF_SETTINGS) has only the five.
      const boxSettings = J({ permissions: { allow: ['Read(./**)'], deny: ['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep',
        'Read(//c/Users/**)', 'Read(C:/Users/**)', 'Read(//c/jicate-ai/**)', 'Read(C:/jicate-ai/**)', 'Read(~/**)'], defaultMode: 'dontAsk' } });
      const boxArgs = proofArgs(boxSettings);
      expect(strictSettings(boxSettings)).toBe(boxSettings); // claude gets the very text it gets today
      expect(fenceOf(boxArgs)).toEqual({ ok: true, args: boxArgs });
    });
    it('hands back the arguments unchanged when there is no --settings', () => {
      const a = [...FENCE, '-p', '--allowedTools', 'Read(./**)'];
      expect(fenceOf(a)).toEqual({ ok: true, args: a });
    });
    it('writes the keys in one fixed order, and only the keys that were given', () => {
      expect(strictSettings(' {"permissions":{"defaultMode":"plan","deny":["Bash","mcp__x__y","Bash(curl:*)","WebFetch(domain:x.example.com)"],"allow":[]}}\n'))
        .toBe('{"permissions":{"allow":[],"deny":["Bash","mcp__x__y","Bash(curl:*)","WebFetch(domain:x.example.com)"],"defaultMode":"plan"}}');
      expect(strictSettings(P({ deny: ['Read(C:/Users/**)'] }))).toBe('{"permissions":{"deny":["Read(C:/Users/**)"]}}');
      expect(strictSettings(P({ allow: ['Read(./**)', 'Grep(./jobs/**)', 'TodoWrite'], defaultMode: 'default' })))
        .toBe('{"permissions":{"allow":["Read(./**)","Grep(./jobs/**)","TodoWrite"],"defaultMode":"default"}}');
      expect(strictSettings('{"permissions":{}}')).toBe('{"permissions":{}}');
      expect(strictSettings('{}')).toBe('{}');
    });

    const refused: [string, string][] = [
      ['a file path', 'C:/jicate-ai/settings.json'],
      ['a relative file path', './settings.json'],
      ['a bare file name', 'settings.json'],
      ['an empty value', ''],
      ['a JSON array', '[{"permissions":{}}]'],
      ['a JSON string', '"{\\"permissions\\":{}}"'],
      ['a JSON number', '42'],
      ['JSON null', 'null'],
      ['invalid JSON', '{"permissions":{"allow":["Read(./**)"],}}'],
      ['invalid JSON (single quotes)', "{'permissions':{}}"],
      ['JSON with a comment', '{"permissions":{} /* x */}'],
      ['text after the object', '{"permissions":{}} {"hooks":{}}'],
      ['top-level hooks', J({ permissions: {}, hooks: { PreToolUse: [] } })],
      ['top-level env', J({ permissions: {}, env: { ANTHROPIC_BASE_URL: 'https://x.example.com' } })],
      ['top-level apiKeyHelper', J({ permissions: {}, apiKeyHelper: 'x.cmd' })],
      ['top-level additionalDirectories', J({ permissions: {}, additionalDirectories: ['C:/jicate-ai'] })],
      ['top-level model', J({ permissions: {}, model: 'opus' })],
      ['top-level mcpServers', J({ permissions: {}, mcpServers: {} })],
      ['top-level enabledPlugins', J({ permissions: {}, enabledPlugins: {} })],
      ['only another key', J({ hooks: {} })],
      ['permissions.additionalDirectories', P({ allow: ['Read(./**)'], additionalDirectories: ['C:/jicate-ai'] })],
      ['permissions.ask', P({ allow: ['Read(./**)'], ask: ['Bash'] })],
      ['permissions.disableBypassPermissionsMode', P({ disableBypassPermissionsMode: 'disable' })],
      ['permissions as an array', J({ permissions: [] })],
      ['permissions as null', J({ permissions: null })],
      ['permissions as a string', J({ permissions: 'allow' })],
      ['allow not an array', P({ allow: 'Read(./**)' })],
      ['allow: Bash', P({ allow: ['Read(./**)', 'Bash'] })],
      ['allow: Bash(curl:*)', P({ allow: ['Bash(curl:*)'] })],
      ['allow: WebFetch', P({ allow: ['WebFetch'] })],
      ['allow: Write', P({ allow: ['Write(./**)'] })],
      ['allow: mcp tool', P({ allow: ['mcp__x__y'] })],
      ['allow: absolute path', P({ allow: ['Read(C:/x)'] })],
      ['allow: ../ path', P({ allow: ['Read(../x)'] })],
      ['allow: ./../ path', P({ allow: ['Read(./../x)'] })],
      ['allow: ".." hidden by escapes', '{"permissions":{"allow":["Read(./\\u002e\\u002e/x)"]}}'],
      ['allow: Bash hidden by escapes', '{"permissions":{"allow":["\\u0042ash"]}}'],
      ['allow: bare Read', P({ allow: ['Read'] })],
      ['allow: home path', P({ allow: ['Read(~/**)'] })],
      ['allow: two rules in one string (space)', P({ allow: ['Read(./a) Bash'] })],
      ['allow: two rules in one string (comma)', P({ allow: ['Read(./a),Bash'] })],
      ['allow: an empty rule', P({ allow: [''] })],
      ['allow: a number', P({ allow: ['Read(./**)', 7] })],
      ['allow: null', P({ allow: [null] })],
      ['allow: a nested array', P({ allow: [['Read(./**)']] })],
      ['allow: an object', P({ allow: [{ tool: 'Read' }] })],
      ['deny not an array', P({ deny: 'Bash' })],
      ['deny: a number', P({ deny: ['Bash', 1] })],
      ['deny: an object', P({ deny: [{}] })],
      ['deny: an empty rule', P({ deny: [''] })],
      ['deny: not rule-shaped', P({ deny: ['*'] })],
      ['deny: two rules in one string', P({ deny: ['Bash Read'] })],
      ['defaultMode bypassPermissions', P({ allow: ['Read(./**)'], defaultMode: 'bypassPermissions' })],
      ['defaultMode acceptEdits', P({ allow: ['Read(./**)'], defaultMode: 'acceptEdits' })],
      ['defaultMode auto', P({ defaultMode: 'auto' })],
      ['defaultMode not a string', P({ defaultMode: ['dontAsk'] })],
      ['"permissions" twice', '{"permissions":{"allow":["Read(./**)"]},"permissions":{"allow":["Read(./**)"]}}'],
      ['"permissions" twice, one spelled with an escape', '{"permissions":{},"permi\\u0073sions":{}}'],
      ['"allow" twice', '{"permissions":{"allow":["Read(./**)"],"allow":["Read(./**)"]}}'],
      ['"defaultMode" twice', '{"permissions":{"defaultMode":"bypassPermissions","defaultMode":"dontAsk"}}'],
      ['a "__proto__" key', '{"__proto__":{"permissions":{}}}'],
      ['a "__proto__" key beside permissions', '{"permissions":{},"__proto__":{}}'],
      ['a "__proto__" key in permissions', '{"permissions":{"__proto__":{"allow":["Bash"]}}}'],
      ['a "constructor" key', '{"permissions":{"constructor":{}}}'],
      ['a "prototype" key', '{"prototype":{}}'],
      ['a value far too long', P({ deny: Array.from({ length: 2000 }, () => 'Read(C:/Users/**)') })],
      // what is left of the JSON when a shell or PowerShell 5.1 strips its double quotes on the way in
      ['JSON that lost its double quotes', '{permissions:{allow:[Read(./**)],deny:[Read(C:/Users/**)],defaultMode:dontAsk}}']
    ];
    it('refuses everything outside the strict shape, with one fixed reason', () => {
      for (const [name, value] of refused) {
        expect(strictSettings(value), name).toBe(null);
        expect(fenceOf(proofArgs(value)), name).toEqual({ ok: false, reason: SETTINGS_REASON });
      }
    });
    it('refuses the --settings=value form, a second --settings anywhere, and a missing value', () => {
      const base = PROOF_ARGS.filter((_, i) => i !== SETTINGS_AT - 1 && i !== SETTINGS_AT);
      expect(fenceOf(base).ok).toBe(true);
      expect(fenceOf([...base, '--settings', GOOD]).ok).toBe(true);
      expect(fenceOf([...base, `--settings=${GOOD}`]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf([...base, '--settings', GOOD, '--settings', GOOD]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf(['--settings', GOOD, ...base, '--settings', GOOD]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf([...base, '--settings', GOOD, `--settings=${GOOD}`]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf([`--settings=${GOOD}`, ...base, '--settings', GOOD]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf([...base, '--settings', GOOD, '--', '--settings', J({ hooks: {} })]).reason).toBe(SETTINGS_REASON); // also past "--"
      expect(fenceOf([...base, '--settings']).reason).toBe(SETTINGS_REASON);
      expect(fenceOf(['--settings', ...base]).reason).toBe(SETTINGS_REASON); // the value would be "-p"
    });
    it('refuses a --settings or --managed-settings token past "--", where it is never checked (with or without a real --settings)', () => {
      const base = PROOF_ARGS.filter((_, i) => i !== SETTINGS_AT - 1 && i !== SETTINGS_AT);
      const HOOKS = J({ hooks: { SessionStart: [] } });
      for (const tail of [
        ['--settings', 'C:/x/evil.json'],
        ['--settings', HOOKS],
        ['--settings', GOOD],
        [`--settings=${HOOKS}`],
        ['--settings='],
        ['--managed-settings', HOOKS],
        [`--managed-settings=${HOOKS}`],
        ['read the proof', '--settings', 'C:/x/evil.json']
      ]) {
        expect(fenceOf([...base, '--', ...tail]), tail.join(' ')).toEqual({ ok: false, reason: SETTINGS_REASON });
        expect(fenceOf([...base, '--settings', GOOD, '--', ...tail]), tail.join(' ')).toEqual({ ok: false, reason: SETTINGS_REASON });
      }
      // the whole argument only: prompt text that merely mentions the option, or a look-alike, still passes
      for (const tail of [['explain --settings to me'], ['--settings-notes'], ['--setting-sources', 'user'], ['--managed-settings-in-initialize'], ['settings', '{}']]) {
        expect(fenceOf([...base, '--', ...tail]).ok, tail.join(' ')).toBe(true);
        expect(fenceOf([...base, '--settings', GOOD, '--', ...tail]).ok, tail.join(' ')).toBe(true);
      }
      // before "--" --managed-settings is refused as before, as an option the shim does not know
      expect(fenceOf([...base, '--managed-settings', HOOKS]).reason).toBe('unknown or unsafe option');
      expect(fenceOf([...base, `--managed-settings=${HOOKS}`]).reason).toBe('unknown or unsafe option');
      // another refusal keeps its own reason
      expect(fenceOf(['-p', '--', '--settings', GOOD]).reason).toBe(SETTINGS_REASON);
      expect(fenceOf([...base, '--mcp-config', 'm.json', '--', '--settings', GOOD]).reason).toBe('MCP, plugin or settings by argument');
    });
    it('takes a value of up to 16,384 characters and refuses a longer one', () => {
      const head = '{"permissions":{"deny":["Read(./';
      const tail = '**)"]}}';
      const sized = (n: number) => head + 'a'.repeat(n - head.length - tail.length) + tail;
      expect(sized(16_384)).toHaveLength(16_384);
      expect(strictSettings(sized(16_384))).toBe(sized(16_384));
      expect(strictSettings(sized(16_385))).toBe(null);
      expect(fenceOf(proofArgs(sized(16_385))).reason).toBe(SETTINGS_REASON);
    });
    it('a valid --settings never rescues a run refused for another reason', () => {
      const S = ['--settings', GOOD];
      expect(fenceOf(['--setting-sources', 'project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--allowedTools', 'Read(./**)', ...S]).reason).toBe('no --tools list');
      expect(why(['--allowedTools', 'Read(./**)', ...S, '--mcp-config', 'm.json'])).toBe('MCP, plugin or settings by argument');
      expect(why(['--allowedTools', 'Read(./**)', '--plugin-dir', 'p', ...S])).toBe('MCP, plugin or settings by argument');
      expect(why([...S, '--add-dir', 'C:/jicate-ai'])).toBe('extra folders by argument');
      expect(why([...S, '--dangerously-skip-permissions'])).toBe('permission bypass');
      expect(why([...S, '--permission-mode', 'bypassPermissions'])).toBe('permission bypass');
      expect(why([...S, '--allowedTools', 'Read(./**),Bash'])).toBe('shell, web or unknown tool allowed');
      expect(why([...S, '--allowedTools', 'Read'])).toBe('file tool not scoped to ./');
      expect(why([...S, '--tools', 'Read,Bash'])).toBe('shell, web or unknown tool allowed');
      expect(fenceOf(['--setting-sources', 'user,project', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--tools', 'Read', ...S]).reason).toBe('user settings loaded');
      expect(fenceOf(['--tools', 'Read', '--permission-mode', 'dontAsk', '--strict-mcp-config', ...S]).reason).toBe('no --setting-sources without user');
      expect(fenceOf(['--setting-sources', 'project', '--tools', 'Read', '--strict-mcp-config', ...S]).reason).toBe('no --permission-mode');
      expect(fenceOf(['--setting-sources', 'project', '--permission-mode', 'dontAsk', '--tools', 'Read', ...S]).reason).toBe('no --strict-mcp-config');
      // defaultMode inside the settings is not a --permission-mode
      expect(fenceOf(['--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Read', '--settings', P({ defaultMode: 'dontAsk' })]).reason).toBe('no --permission-mode');
    });
    it('the reason never carries the settings text', () => {
      expect(JSON.stringify(fenceOf(proofArgs('C:/SECRET/settings.json')))).not.toContain('SECRET');
      expect(JSON.stringify(fenceOf(proofArgs(J({ SECRET_KEY: 'SECRET' }))))).not.toContain('SECRET');
      expect(JSON.stringify(fenceOf(proofArgs(P({ allow: ['Bash(SECRET)'] }))))).not.toContain('SECRET');
    });
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

describe('refusalOf (which failed runs count as the account refused)', async () => {
  const { refusalOf } = await import('../windows/jicate-ai-engine/claude-acct.mjs');
  const failed = (result: string) =>
    refusalOf({ code: 1, stderr: Buffer.alloc(0), stdout: Buffer.from(JSON.stringify({ type: 'result', is_error: true, result })) });
  it('matches every "hit your ... limit" wording Claude uses', () => {
    expect(failed("You've hit your limit · resets 3pm")).toBe('limit');
    expect(failed("You've hit your weekly limit · resets Nov 18, 5:30am")).toBe('limit');
    expect(failed("You've hit your 5-hour limit · resets 3pm")).toBe('limit');
    expect(failed('Session limit reached ∙ resets 3pm')).toBe('limit');
    expect(failed('Claude AI usage limit reached|1763200000')).toBe('limit');
    expect(failed("You've hit your weekly limit · resets Nov 19, 2:30pm (Asia/Kolkata)")).toBe('limit');
    expect(failed('5-hour limit reached ∙ resets 3pm')).toBe('limit');
    expect(failed('API Error: 429 rate limit')).toBe('limit');
  });
  it('a good answer that says "weekly limit" is never a refusal', () => {
    const ok = { code: 0, stderr: Buffer.alloc(0), stdout: Buffer.from(JSON.stringify({ type: 'result', is_error: false, result: 'You hit your weekly limit of coffee' })) };
    expect(refusalOf(ok)).toBe(null);
  });
  it('an unrelated failure is not a refusal', () => {
    expect(failed('max turns reached')).toBe(null);
  });
  it('a bad key still counts as auth', () => {
    expect(failed('Failed to authenticate. API Error: 401')).toBe('auth');
    expect(failed('Invalid API key · Please run /login')).toBe('auth');
  });
  it('the organisation block counts as a refusal: the whole phrase, any case, in the result or on stderr', () => {
    const phrase = 'Your organization has disabled Claude subscription access for Claude Code';
    expect(failed(phrase)).toBe('org');
    expect(failed(`${phrase}. Ask your organization’s admin, or use your team's API key.`)).toBe('org');
    expect(failed(`API Error: ${phrase.toUpperCase()}`)).toBe('org');
    expect(failed('your  organization has disabled claude subscription access for claude code')).toBe('org');
    expect(refusalOf({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`${phrase}\n`) })).toBe('org');
    // plain-text output wrapped over two lines
    expect(refusalOf({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('Your organization has disabled\nClaude subscription access for Claude Code\n') })).toBe('org');
  });
  it('the word "organization", or half the phrase, is not a refusal', () => {
    expect(failed('your organization could not be loaded')).toBe(null);
    expect(failed('Your organization has disabled Claude subscription access')).toBe(null);
    expect(failed('Your organization has disabled web search for Claude Code')).toBe(null);
    expect(failed('organization')).toBe(null);
  });
  it('a good answer that quotes the organisation phrase is never a refusal', () => {
    const ok = { code: 0, stderr: Buffer.alloc(0), stdout: Buffer.from(JSON.stringify({ type: 'result', is_error: false, result: 'Your organization has disabled Claude subscription access for Claude Code' })) };
    expect(refusalOf(ok)).toBe(null);
  });
});
