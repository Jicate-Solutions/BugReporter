import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** box-agent.json must never silently turn remote control off (24 Oct 2026: a BOM did). */
process.env.JICATE_BOX_AGENT_NO_MAIN = '1';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadConfig: (dir: string, log?: (s: string) => void) => any;
beforeAll(async () => {
  ({ loadConfig } = (await import('@/windows/jicate-ai-engine/jicate-box-agent.mjs')) as any);
});

const cfg = { restartTasks: [{ task: 'ai.jicate.engine-1' }], updatePublicKey: 'KEY' };
const fresh = () => mkdtempSync(path.join(tmpdir(), 'box-cfg-'));

describe('loadConfig', () => {
  it('reads a file that starts with a UTF-8 BOM and saves a last-good copy', () => {
    const d = fresh();
    writeFileSync(path.join(d, 'box-agent.json'), '﻿' + JSON.stringify(cfg));
    expect(loadConfig(d)).toEqual(cfg);
    expect(JSON.parse(readFileSync(path.join(d, 'box-agent.json.last-good'), 'utf8'))).toEqual(cfg);
  });

  it('falls back to the last-good copy when the file does not parse, and says so', () => {
    const d = fresh();
    writeFileSync(path.join(d, 'box-agent.json.last-good'), JSON.stringify(cfg));
    writeFileSync(path.join(d, 'box-agent.json'), '{ broken');
    const lines: string[] = [];
    expect(loadConfig(d, (s) => lines.push(s))).toEqual(cfg);
    expect(lines.join(' ')).toMatch(/last-good/);
  });

  it('runs with defaults when there is nothing readable at all', () => {
    const d = fresh();
    writeFileSync(path.join(d, 'box-agent.json'), 'nope');
    expect(loadConfig(d)).toEqual({ restartTasks: [] });
    expect(existsSync(path.join(d, 'box-agent.json.last-good'))).toBe(false);
  });

  it('does not let a copy without the signing key overwrite one that has it', () => {
    const d = fresh();
    writeFileSync(path.join(d, 'box-agent.json.last-good'), JSON.stringify(cfg));
    writeFileSync(path.join(d, 'box-agent.json'), JSON.stringify({ restartTasks: [] }));
    loadConfig(d);
    expect(JSON.parse(readFileSync(path.join(d, 'box-agent.json.last-good'), 'utf8')).updatePublicKey).toBe('KEY');
  });
});
