import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Box keys, box side (jicate-box-agent.mjs): the env-file rewrite keeps every
 * other line byte-identical, replaces an existing NAME= line, appends a
 * missing one, drops a byte-order mark, backs the file up first, never creates
 * a missing file, refuses anything off the agent's own list, and never puts
 * the value in a log line or a report.
 */

process.env.JICATE_BOX_AGENT_NO_MAIN = '1';
let agent: any;
beforeAll(async () => {
  agent = await import('@/windows/jicate-ai-engine/jicate-box-agent.mjs');
});

const VALUE = 'ghp_' + 'Q1w2E3r4T5'.repeat(4);
const NAME = 'BUILD_GITHUB_TOKEN';

describe('rewriteEnv', () => {
  it('replaces an existing line in place, keeping CRLF and every other byte', () => {
    const before = 'A=1\r\nBUILD_GITHUB_TOKEN=old\r\n# note\r\nB=two words\r\n';
    const r = agent.rewriteEnv(before, NAME, VALUE);
    expect(r.text).toBe(`A=1\r\nBUILD_GITHUB_TOKEN=${VALUE}\r\n# note\r\nB=two words\r\n`);
    expect(r).toMatchObject({ changed: true, replaced: 1 });
  });

  it('replaces an unterminated last line and leaves it unterminated', () => {
    expect(agent.rewriteEnv('A=1\nBUILD_GITHUB_TOKEN=', NAME, VALUE).text).toBe(`A=1\nBUILD_GITHUB_TOKEN=${VALUE}`);
  });

  it('appends a missing line with the file\'s own line ending', () => {
    expect(agent.rewriteEnv('A=1\r\nB=2\r\n', NAME, VALUE).text).toBe(`A=1\r\nB=2\r\nBUILD_GITHUB_TOKEN=${VALUE}\r\n`);
    expect(agent.rewriteEnv('A=1\nB=2', NAME, VALUE).text).toBe(`A=1\nB=2\nBUILD_GITHUB_TOKEN=${VALUE}\n`);
    expect(agent.rewriteEnv('', NAME, VALUE).text).toBe(`BUILD_GITHUB_TOKEN=${VALUE}\r\n`);
  });

  it('does not touch a variable that only starts with the same name', () => {
    const r = agent.rewriteEnv('BUILD_GITHUB_TOKEN_OLD=x\n', NAME, VALUE);
    expect(r.text).toBe(`BUILD_GITHUB_TOKEN_OLD=x\nBUILD_GITHUB_TOKEN=${VALUE}\n`);
    expect(r.replaced).toBe(0);
  });

  it('drops a UTF-8 byte-order mark', () => {
    const r = agent.rewriteEnv('\uFEFFA=1\n', NAME, VALUE);
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(r.text).toBe(`A=1\nBUILD_GITHUB_TOKEN=${VALUE}\n`);
  });

  it('reports no change when the value is already there', () => {
    const text = `A=1\r\nBUILD_GITHUB_TOKEN=${VALUE}\r\n`;
    expect(agent.rewriteEnv(text, NAME, VALUE)).toMatchObject({ text, changed: false, replaced: 1 });
  });

  it('refuses a value or name that could inject another line', () => {
    expect(() => agent.rewriteEnv('', NAME, `${VALUE}\nEVIL=1`)).toThrow();
    expect(() => agent.rewriteEnv('', 'A=B', VALUE)).toThrow();
  });
});

describe('boxKeyTarget (the agent\'s own allow-list)', () => {
  const entry = {
    id: 'build-worker-github-token',
    file: 'C:\\jicate-ai\\build-worker\\build-worker.env',
    name: NAME
  };
  it('accepts exactly the listed box, id, file and variable', () => {
    expect(agent.boxKeyTarget('DESKTOP-1LB1FCS', entry)).toBeTruthy();
    expect(agent.boxKeyTarget('desktop-1lb1fcs', entry)).toBeTruthy();
  });
  it('refuses another box, another path, or another variable', () => {
    expect(agent.boxKeyTarget('Biometric', entry)).toBeNull();
    expect(agent.boxKeyTarget('DESKTOP-1LB1FCS', { ...entry, file: 'C:\\Windows\\win.ini' })).toBeNull();
    expect(agent.boxKeyTarget('DESKTOP-1LB1FCS', { ...entry, file: 'C:\\jicate-ai\\box-agent.env' })).toBeNull();
    expect(agent.boxKeyTarget('DESKTOP-1LB1FCS', { ...entry, name: 'PATH' })).toBeNull();
    expect(agent.boxKeyTarget('DESKTOP-1LB1FCS', { ...entry, id: 'other' })).toBeNull();
  });
});

describe('deliverBoxKey', () => {
  function setup(content: string | null) {
    const dir = mkdtempSync(path.join(tmpdir(), 'box-key-'));
    const file = path.join(dir, 'build-worker.env');
    if (content !== null) writeFileSync(file, content);
    const target = { box: 'BOX2', id: 'build-worker-github-token', file, name: NAME };
    const logs: string[] = [];
    const reports: Record<string, unknown>[] = [];
    const fetched: string[] = [];
    const deps = {
      box: 'BOX2',
      targets: [target],
      log: (s: string) => logs.push(s),
      report: async (u: Record<string, unknown>) => void reports.push(u),
      fetchValue: async (id: string) => (fetched.push(id), { value: VALUE, set_at: 'S2' }),
      now: () => new Date(2026, 9, 26, 21, 5, 9)
    };
    const entry = { id: target.id, file, name: NAME, set_at: 'S1' };
    const noValueAnywhere = () => {
      expect(logs.join('\n')).not.toContain(VALUE);
      expect(JSON.stringify(reports)).not.toContain(VALUE);
    };
    return { dir, file, logs, reports, fetched, deps, entry, noValueAnywhere };
  }

  it('replaces the line, keeps the rest byte-identical, writes no BOM, keeps a backup, reports delivered', async () => {
    const before = '\uFEFFREPO=Jicate-Solutions/BugReporter\r\nBUILD_GITHUB_TOKEN=old-token-1\r\nPOLL=60\r\n';
    const s = setup(before);
    const out = await agent.deliverBoxKey(s.entry, s.deps);
    const after = readFileSync(s.file);
    expect(after.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(after.toString('utf8')).toBe(`REPO=Jicate-Solutions/BugReporter\r\nBUILD_GITHUB_TOKEN=${VALUE}\r\nPOLL=60\r\n`);
    const backups = readdirSync(s.dir).filter((n) => n.startsWith('build-worker.env.bak-'));
    expect(backups).toEqual(['build-worker.env.bak-20261026-210509']);
    expect(readFileSync(path.join(s.dir, backups[0]), 'utf8')).toBe(before);
    expect(out).toEqual({ id: 'build-worker-github-token', set_at: 'S2', status: 'delivered' });
    expect(s.reports).toEqual([out]);
    s.noValueAnywhere();
  });

  it('appends a missing variable', async () => {
    const s = setup('REPO=x\n');
    await agent.deliverBoxKey(s.entry, s.deps);
    expect(readFileSync(s.file, 'utf8')).toBe(`REPO=x\nBUILD_GITHUB_TOKEN=${VALUE}\n`);
    expect(s.reports[0]).toMatchObject({ status: 'delivered' });
    s.noValueAnywhere();
  });

  it('writes nothing (no backup) when the value is already there, and still reports delivered', async () => {
    const s = setup(`BUILD_GITHUB_TOKEN=${VALUE}\n`);
    await agent.deliverBoxKey(s.entry, s.deps);
    expect(readdirSync(s.dir)).toEqual(['build-worker.env']);
    expect(s.reports[0]).toMatchObject({ status: 'delivered' });
    s.noValueAnywhere();
  });

  it('never creates a missing file and never fetches the value for it', async () => {
    const s = setup(null);
    await agent.deliverBoxKey(s.entry, s.deps);
    expect(existsSync(s.file)).toBe(false);
    expect(s.fetched).toEqual([]);
    expect(s.reports).toEqual([{ id: 'build-worker-github-token', set_at: 'S1', status: 'failed', reason: 'file missing' }]);
  });

  it('refuses a listed key aimed at another file, without fetching the value', async () => {
    const s = setup('A=1\n');
    const other = path.join(s.dir, 'other.env');
    writeFileSync(other, 'A=1\n');
    await agent.deliverBoxKey({ ...s.entry, file: other }, s.deps);
    expect(readFileSync(other, 'utf8')).toBe('A=1\n');
    expect(s.fetched).toEqual([]);
    expect(s.reports[0]).toMatchObject({ status: 'failed', reason: 'not on the box agent list' });
  });

  it('refuses an unusable value from the Tower and writes nothing', async () => {
    const s = setup('A=1\n');
    s.deps.fetchValue = async () => ({ value: `${VALUE}\nEVIL=1`, set_at: 'S2' });
    await agent.deliverBoxKey(s.entry, s.deps);
    expect(readFileSync(s.file, 'utf8')).toBe('A=1\n');
    expect(s.reports[0]).toMatchObject({ status: 'failed', reason: 'value not usable' });
    s.noValueAnywhere();
  });
});
