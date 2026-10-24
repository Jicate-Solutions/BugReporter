import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign, createHash, type KeyObject } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * The box side of remote control: the pure parts of jicate-box-agent.mjs
 * (command checks, restart allow-list, report scrubbing, where each published
 * file goes) and the launcher's self-update rules. The agent is imported with
 * JICATE_BOX_AGENT_NO_MAIN=1 so nothing runs.
 */

process.env.JICATE_BOX_AGENT_NO_MAIN = '1';
type Agent = Record<string, any>;
let agent: Agent;
beforeAll(async () => {
  agent = await import('@/windows/jicate-ai-engine/jicate-box-agent.mjs');
});

const DIR = path.resolve(__dirname, '..', 'windows', 'jicate-ai-engine');
const NOW = Date.parse('2026-10-24T06:00:00.000Z');
const ID = '3f0c2b1a-9d8e-4c7b-a6f5-0e1d2c3b4a59';
const OTHER_ID = '11111111-2222-4333-8444-555555555555';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const stranger = generateKeyPairSync('ed25519');

function payload(over: Record<string, unknown> = {}) {
  const p = { id: ID, box: 'BIOMETRIC', verb: 'status', args: {}, expires_at: new Date(NOW + 30 * 60_000).toISOString(), ...over };
  return JSON.stringify({ id: p.id, box: p.box, verb: p.verb, args: p.args, expires_at: p.expires_at });
}
function row(text: string, key: KeyObject = privateKey, extra: Record<string, unknown> = {}) {
  return { id: ID, verb: 'status', payload: text, signature: sign(null, Buffer.from(text, 'utf8'), key).toString('base64'), ...extra };
}
const check = (r: unknown, opts: Record<string, unknown> = {}) =>
  agent.verifyCommand(r, { key: publicKey, box: 'Biometric', nowMs: NOW, ledger: {}, ...opts });

describe('verifyCommand', () => {
  it('accepts a signed, current command for this box (box name case-insensitive)', () => {
    const v = check(row(payload()));
    expect(v.ok).toBe(true);
    expect(v.payload).toMatchObject({ id: ID, verb: 'status', args: {} });
  });

  it('verifies the exact payload text, not a re-serialized copy', () => {
    const spaced = JSON.stringify(JSON.parse(payload()), null, 2);
    expect(check(row(spaced)).ok).toBe(true);
  });

  it('refuses a bad or foreign signature and a tampered payload', () => {
    expect(check(row(payload(), stranger.privateKey))).toEqual({ ok: false, reason: 'signature does not verify' });
    const r = row(payload());
    expect(check({ ...r, payload: r.payload.replace('status', 'run-script') }).reason).toBe('signature does not verify');
    expect(check({ ...r, signature: 'not base64 at all' }).reason).toBe('signature does not verify');
  });

  it('refuses when the box has no update key', () => {
    expect(check(row(payload()), { key: null }).reason).toMatch(/no usable updatePublicKey/);
  });

  it('refuses an id that does not match the row, and another box', () => {
    expect(check(row(payload({ id: OTHER_ID }))).reason).toBe('payload id does not match the command row');
    expect(check(row(payload({ box: 'DESKTOP-1LB1FCS' }))).reason).toMatch(/not this box/);
  });

  it('refuses expired commands and ones that expire more than 6 hours ahead, by the Tower clock', () => {
    expect(check(row(payload({ expires_at: new Date(NOW - 1000).toISOString() }))).reason).toBe('expired');
    expect(check(row(payload({ expires_at: new Date(NOW + 7 * 3_600_000).toISOString() }))).reason).toBe('expires more than 6 hours ahead');
    expect(check(row(payload({ expires_at: new Date(NOW + 6 * 3_600_000).toISOString() }))).ok).toBe(true);
    // Tower clock is what counts: same payload, Tower already past expiry.
    expect(check(row(payload()), { nowMs: NOW + 31 * 60_000 }).reason).toBe('expired');
    expect(check(row(payload({ expires_at: 'tomorrow' }))).reason).toBe('payload has no valid expires_at');
  });

  it('refuses an unknown verb and a row verb that differs from the signed one', () => {
    expect(check(row(payload({ verb: 'format-disk' }))).reason).toMatch(/unknown verb/);
    expect(check(row(payload(), privateKey, { verb: 'restart-task' })).reason).toBe('row verb does not match the signed verb');
  });

  it('refuses a replay of an id already in the ledger', () => {
    expect(check(row(payload()), { ledger: { [ID]: { final: 'done', sent: true } } }).reason).toMatch(/^replay/);
  });

  it('refuses malformed rows and non-object args', () => {
    expect(check(null).reason).toBe('malformed command row');
    expect(check({ ...row(payload()), id: 'nope' }).reason).toBe('malformed command row');
    expect(check(row(payload({ args: ['x'] }))).reason).toBe('args must be an object');
  });
});

describe('restartSelection', () => {
  const restart = () =>
    agent.normalizeRestart({
      restartTasks: [
        { task: 'ai.jicate.engine-1', match: 'jicate-ai-drain.mjs' },
        { task: 'ai.jicate.engine-2', match: 'jicate-ai-drain.mjs' },
        { task: 'myjkkn-worker', match: 'myjkkn-run.mjs' },
        'plain-task',
        { task: 'ai.jicate.box-agent' },
        { task: 'sneaky', match: 'jicate-box-agent.mjs' }
      ]
    });

  it('drops entries whose match would hit the agent', () => {
    expect(restart().map((t: { task: string }) => t.task)).not.toContain('sneaky');
  });

  it('allows only restartTasks names and brings back tasks that share a match', () => {
    const sel = agent.restartSelection(restart(), 'ai.jicate.engine-1');
    expect(sel.list.map((t: { task: string }) => t.task)).toEqual(['ai.jicate.engine-1', 'ai.jicate.engine-2']);
    expect(agent.restartSelection(restart(), 'plain-task').list).toEqual([{ task: 'plain-task' }]);
    expect(agent.restartSelection(restart(), 'myjkkn-worker').list.map((t: { task: string }) => t.task)).toEqual(['myjkkn-worker']);
  });

  it('refuses unknown tasks and the agent\'s own task', () => {
    expect(agent.restartSelection(restart(), 'ai.jicate.engine-9').error).toMatch(/not in box-agent.json restartTasks/);
    expect(agent.restartSelection(restart(), 'ai.jicate.box-agent').error).toMatch(/own task/);
    expect(agent.restartSelection(restart(), 'custom-agent-task', 'custom-agent-task').error).toMatch(/own task/);
    expect(agent.restartSelection(restart(), 'a&b').error).toMatch(/not allowed/);
    expect(agent.restartSelection(restart(), undefined).error).toMatch(/missing/);
  });
});

describe('status report scrubbing', () => {
  it('removes secret-looking keys from box-agent.json and fingerprints the public key', () => {
    const pub = 'MCowBQYDK2VwAyEA' + 'x'.repeat(44);
    const out = agent.scrubConfig({
      restartTasks: [{ task: 'ai.jicate.engine-1', match: 'jicate-ai-drain.mjs' }],
      updatePublicKey: pub,
      token: 'abc',
      apiKey: 'k',
      nested: { password: 'p', clientSecret: 's', note: 'Bearer abcdef123456' },
      mailClientPath: 'C:\\jicate-mail\\jicate-mail.mjs'
    });
    expect(out.restartTasks).toEqual([{ task: 'ai.jicate.engine-1', match: 'jicate-ai-drain.mjs' }]);
    expect(out.token).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.clientSecret).toBe('[redacted]');
    expect(out.nested.note).toBe('Bearer [redacted]');
    expect(out.mailClientPath).toBe('C:\\jicate-mail\\jicate-mail.mjs');
    expect(out.updatePublicKey).toMatch(/^\[set; sha256 [0-9a-f]{8}\]$/);
    expect(JSON.stringify(out)).not.toContain(pub);
  });

  it('scrubs log lines: key=value secrets, bearer tokens, long base64 and hex', () => {
    const b64 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
    const hex = 'ab16fc1b59d62576dd18aa7a79295a5065b0eb68180afcdc96dba9662f92af71';
    const s = agent.scrubText(
      `2026-10-24T05:00:00.000Z [box-agent] token=${b64} password: hunter2 Authorization: Bearer xyz.abc sha ${hex} key sk-ant-oat01-abc_DEF-123`
    );
    expect(s).not.toContain(b64);
    expect(s).not.toContain('hunter2');
    expect(s).not.toContain('xyz.abc');
    expect(s).not.toContain(hex);
    expect(s).not.toContain('sk-ant-oat01');
    expect(s).toContain('2026-10-24T05:00:00.000Z [box-agent]');
  });

  it('keeps ordinary log lines readable (short shas, ids, task names)', () => {
    const line = `2026-10-24T05:00:00.000Z [box-agent] file updated jicate-ai-drain.mjs ab16fc1b -> 9f8e7d6c; restarted 2 task(s); command ${ID} status: done`;
    expect(agent.scrubText(line)).toBe(line);
  });

  it('caps a report well under the Tower\'s 128 KB limit', () => {
    const big = { host: 'B', log_tail: Array.from({ length: 2000 }, () => 'x'.repeat(200)), files: {} };
    const out = agent.capReport(big);
    expect(JSON.stringify(out).length).toBeLessThan(110_000);
    expect(out.truncated).toBe(true);
    expect(out.host).toBe('B');
    const small = { a: 1 };
    expect(agent.capReport(small)).toBe(small);
  });
});

describe('where each published file goes', () => {
  const here = 'C:\\jicate-ai';
  const plan = (name: string, mailClientPath?: string) => agent.installPlan(name, { here, mailClientPath });

  it('covers exactly the ten allow-listed names', () => {
    expect(agent.BOX_FILES).toHaveLength(10);
    expect(plan('evil.mjs').skip).toMatch(/not a file this agent installs/);
    expect(plan('../jicate-ai-drain.mjs').skip).toBeDefined();
  });

  it('keeps the worker on the swap + health-check path', () => {
    expect(plan('jicate-ai-drain.mjs')).toMatchObject({ kind: 'worker', check: true, fill: false });
    expect(plan('run-jicate-ai-drain.cmd')).toMatchObject({ kind: 'worker', check: false, fill: true });
  });

  it('only stages the agent and its launcher, never overwrites them', () => {
    expect(plan('jicate-box-agent.mjs')).toMatchObject({ kind: 'stage', check: true });
    expect(plan('run-jicate-box-agent.cmd')).toMatchObject({ kind: 'stage', check: false, fill: true });
  });

  it('installs the mail client only at an absolute mailClientPath ending in jicate-mail.mjs', () => {
    expect(plan('jicate-mail.mjs').skip).toMatch(/no mailClientPath/);
    expect(plan('jicate-mail.mjs', 'jicate-mail.mjs').skip).toMatch(/full path/);
    expect(plan('jicate-mail.mjs', 'C:\\mail\\other.mjs').skip).toMatch(/full path/);
    expect(plan('jicate-mail.mjs', 'C:\\Users\\win-ai\\jicate-mail\\jicate-mail.mjs')).toMatchObject({
      kind: 'install', target: 'C:\\Users\\win-ai\\jicate-mail\\jicate-mail.mjs', check: true
    });
  });

  it('installs task XML into the agent folder as UTF-16', () => {
    for (const name of agent.XML_FILES) expect(plan(name)).toMatchObject({ kind: 'install', check: false, utf16: true });
    expect(agent.XML_FILES).toHaveLength(5);
  });
});

describe('box-adapted copies', () => {
  it('rebuilds the repo task XML byte for byte from its published UTF-8 text', () => {
    for (const name of ['ai.jicate.box-agent.xml', 'ai.jicate.engine-1.xml']) {
      const raw = readFileSync(path.join(DIR, name));
      const utf8 = Buffer.from(raw.subarray(2).toString('utf16le'), 'utf8');
      expect(agent.xmlForSchtasks(utf8).equals(raw)).toBe(true);
      expect(agent.xmlForSchtasks(raw).equals(raw)).toBe(true);
    }
  });

  it('gives schtasks UTF-16 even for an XML declared as UTF-8', () => {
    const out = agent.xmlForSchtasks(Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\r\n<Task/>', 'utf8'));
    expect([out[0], out[1]]).toEqual([0xff, 0xfe]);
    expect(out.subarray(2).toString('utf16le')).toBe('<?xml version="1.0" encoding="UTF-16"?>\r\n<Task/>');
  });

  it('fills launcher placeholders with this box\'s paths', () => {
    const published = readFileSync(path.join(DIR, 'run-jicate-box-agent.cmd'), 'utf8');
    const live = '@echo off\r\nset "NODE_BIN=C:\\Program Files\\nodejs\\node.exe"\r\n';
    const r = agent.fillPlaceholders(published, live, 'D:\\other\\node.exe');
    expect(r.error).toBeUndefined();
    expect(r.text).toContain('set "NODE_BIN=C:\\Program Files\\nodejs\\node.exe"');
    expect(r.text).not.toContain('__NODE_EXE__');
    // No live value: this node.
    expect(agent.fillPlaceholders(published, '', 'D:\\node\\node.exe').text).toContain('set "NODE_BIN=D:\\node\\node.exe"');
  });

  it('carries CLAUDE_BIN from the live worker launcher and refuses when it cannot', () => {
    const published = readFileSync(path.join(DIR, 'run-jicate-ai-drain.cmd'), 'utf8');
    const live = 'set "CLAUDE_BIN=C:\\Users\\w\\.local\\bin\\claude.exe"\r\nset "NODE_BIN=C:\\node\\node.exe"\r\n';
    const r = agent.fillPlaceholders(published, live, 'X');
    expect(r.text).toContain('set "CLAUDE_BIN=C:\\Users\\w\\.local\\bin\\claude.exe"');
    expect(r.text).toContain('set "NODE_BIN=C:\\node\\node.exe"');
    expect(agent.fillPlaceholders(published, '', 'X').error).toMatch(/__CLAUDE_EXE__/);
  });
});

describe('the launcher and the agent task', () => {
  const cmd = readFileSync(path.join(DIR, 'run-jicate-box-agent.cmd'), 'utf8');
  const lines = cmd.split('\r\n');

  it('is CRLF throughout, ASCII, and keeps the __NODE_EXE__ placeholder', () => {
    expect(cmd.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(cmd.endsWith('\r\n')).toBe(true);
    expect(cmd).not.toMatch(/[^\x00-\x7f]/);
    expect(cmd).toContain('set "NODE_BIN=__NODE_EXE__"');
  });

  it('names the staged files the agent looks for', () => {
    expect(cmd).toContain('jicate-box-agent.mjs.new');
    expect(cmd).toContain('run-jicate-box-agent.cmd.new');
    expect(cmd).toContain('jicate-box-agent.mjs.rejected');
    expect(cmd).toContain('jicate-box-agent.swapped');
  });

  it('checks a staged agent on a .mjs copy before swapping it', () => {
    expect(cmd).toMatch(/copy \/y "%HERE%jicate-box-agent\.mjs\.new" "%HERE%jicate-box-agent\.check\.mjs"/);
    expect(cmd).toMatch(/--check "%HERE%jicate-box-agent\.check\.mjs"/);
  });

  it('replaces itself only on one line that also exits, after node has run', () => {
    const nodeLine = lines.findIndex((l) => l.startsWith('"%NODE_BIN%" "%AGENT%"'));
    const swap = lines.findIndex((l) => l.includes('move /y "%HERE%run-jicate-box-agent.cmd.new" "%~f0"'));
    expect(nodeLine).toBeGreaterThan(0);
    expect(swap).toBeGreaterThan(nodeLine);
    expect(lines[swap]).toMatch(/^if exist .*\(copy .*& move \/y .*& exit \/b 0\)$/);
    expect(lines[swap + 1]).toBe('exit /b 0');
  });

  it('runs the agent task at the highest available level, everything else unchanged', () => {
    const xml = readFileSync(path.join(DIR, 'ai.jicate.box-agent.xml')).subarray(2).toString('utf16le');
    expect(xml).toContain('<RunLevel>HighestAvailable</RunLevel>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
  });
});

describe('small helpers', () => {
  it('sums 7 days of api cost from worker log lines', () => {
    const day = 86_400_000;
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    const text = [
      `${at(1000)} [jicate-ai] DONE j1 status=done in 10ms type=x model=m api_cost_usd=0.25`,
      `${at(2 * day)} [jicate-ai] DONE j2 status=done in 10ms type=x model=m api_cost_usd=1.5`,
      `${at(8 * day)} [jicate-ai] DONE j3 status=done in 10ms type=x model=m api_cost_usd=9`,
      `${at(1000)} [jicate-ai] DONE j4 status=done api_cost_usd=n/a`,
      JSON.stringify({ ts: at(3 * day), api_cost_usd: 0.05 })
    ].join('\r\n');
    expect(agent.costSum(text, NOW, 7)).toEqual({ usd: 1.8, jobs: 3, days: 7 });
  });

  it('reads task state from schtasks LIST output', () => {
    const out = 'Folder: \\\r\nTaskName: \\ai.jicate.engine-1\r\nStatus: Running\r\nLast Run Time: 24-10-2026 10:01:00\r\nLast Result: 267009\r\nRun As User: win-ai\r\n';
    expect(agent.parseTaskList(out)).toMatchObject({ state: 'Running', last_run: '24-10-2026 10:01:00', last_result: '267009', run_as: 'win-ai' });
  });

  it('keeps the last 4 KB of script output', () => {
    const buf = Buffer.from('a'.repeat(5000) + 'END', 'utf8');
    const t = agent.tailText(buf, 4096);
    expect(t.length).toBe(4096);
    expect(t.endsWith('END')).toBe(true);
  });

  it('hashes like shasum', () => {
    expect(agent.sha256(Buffer.from('x'))).toBe(createHash('sha256').update('x').digest('hex'));
  });
});
