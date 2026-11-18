import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * scripts/mac-push-usage.mjs: turns the Mac's quota cache into Tower readings.
 * Fresh readings only, % → 0-1, relative reset ("in 3d 4h") → epoch measured
 * from when it was read and rounded up, never a call in --dry.
 */

const SCRIPT = resolve(__dirname, '../scripts/mac-push-usage.mjs');
type Body = {
  label: string;
  seven_day_util: number;
  seven_day_resets_at: number;
  five_hour_util?: number;
  five_hour_resets_at?: number;
  read_at: number;
  source: string;
};
const mod = (await import(pathToFileURL(SCRIPT).href)) as {
  labelOf: (e: string) => string | null;
  relativeSeconds: (t: string) => number | null;
  resetEpoch: (iso: string | undefined, rel: string, fetchedMs: number) => number | null;
  buildReadings: (
    cache: unknown,
    now: number
  ) => { send: Body[]; skipped: { label?: string; email?: string; why: string }[] };
};

const NOW = Date.parse('2026-11-18T07:30:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('relativeSeconds', () => {
  it('rounds up by the unit the cache dropped', () => {
    expect(mod.relativeSeconds('in 3d 4h')).toBe(3 * 86400 + 4 * 3600 + 3600);
    expect(mod.relativeSeconds('in 9h 36m')).toBe(9 * 3600 + 36 * 60 + 60);
    expect(mod.relativeSeconds('in 56m')).toBe(56 * 60 + 60);
  });
  it('has no time for empty, due or unknown text', () => {
    for (const t of ['', 'due', 'tomorrow', 'in 3 days']) expect(mod.relativeSeconds(t)).toBeNull();
  });
});

describe('resetEpoch', () => {
  it('counts from when the reading was taken, not from now', () => {
    const fetched = NOW - 10 * 60_000;
    expect(mod.resetEpoch(undefined, 'in 56m', fetched)).toBe(Math.ceil(fetched / 1000) + 57 * 60);
  });
  it('prefers an ISO time when the cache has one', () => {
    expect(mod.resetEpoch('2026-11-20T00:00:00Z', 'in 1m', NOW)).toBe(Date.parse('2026-11-20T00:00:00Z') / 1000);
  });
});

describe('labelOf', () => {
  it('uses the email local part', () => {
    expect(mod.labelOf('aimech@jkkn.ac.in')).toBe('aimech');
    expect(mod.labelOf('AiAHS@jkkn.ac.in')).toBe('aiahs');
    expect(mod.labelOf('default@x.in')).toBeNull();
    expect(mod.labelOf('first.last@x.in')).toBeNull();
  });
});

describe('buildReadings', () => {
  const cache = {
    written_at: minsAgo(5),
    accounts: {
      'aimech@jkkn.ac.in': { five_hour_pct: null, seven_day_pct: 85, sd_reset: 'in 9h 36m', fh_reset: '', fetched_at: minsAgo(5) },
      'ainursing@jkkn.ac.in': { five_hour_pct: 11, seven_day_pct: 100, sd_reset: 'in 3d 1h', fh_reset: 'in 56m', fetched_at: minsAgo(19) },
      'aiahs@jkkn.ac.in': { seven_day_pct: 48, sd_reset: 'in 4d 22h', fetched_at: minsAgo(21), error: 'rate-limited' },
      'aidental@jkkn.ac.in': { error: 'rate-limited (parked to 13:23)' },
      'aicse@jkkn.ac.in': { seven_day_pct: 0, sd_reset: 'due', fetched_at: minsAgo(1) },
      'aieee@jkkn.ac.in': { seven_day_pct: null, sd_reset: 'in 1d 0h', fetched_at: minsAgo(1) }
    }
  };
  const out = mod.buildReadings(cache, NOW);

  it('sends only fresh readings, as 0-1, stamped with fetched_at', () => {
    expect(out.send.map((b) => b.label)).toEqual(['aimech', 'ainursing']);
    const mech = out.send[0];
    expect(mech).toEqual({
      label: 'aimech',
      seven_day_util: 0.85,
      seven_day_resets_at: Math.ceil((NOW - 5 * 60_000) / 1000) + 9 * 3600 + 37 * 60,
      read_at: Math.floor((NOW - 5 * 60_000) / 1000),
      source: 'mac'
    });
    const nurse = out.send[1];
    expect(nurse.seven_day_util).toBe(1);
    expect(nurse.five_hour_util).toBe(0.11);
    expect(nurse.five_hour_resets_at).toBe(Math.ceil((NOW - 19 * 60_000) / 1000) + 57 * 60);
  });

  it('always sends read_at, keeps the 5-hour pair together, and never sends more than 1', () => {
    const over = mod.buildReadings(
      {
        accounts: {
          'aiece@jkkn.ac.in': { seven_day_pct: 103, five_hour_pct: 120, sd_reset: 'in 2d 7h', fh_reset: 'in 3h 2m', fetched_at: minsAgo(2) },
          'aimech@jkkn.ac.in': { seven_day_pct: 50, five_hour_pct: 20, sd_reset: 'in 2d 7h', fh_reset: '', fetched_at: minsAgo(2) }
        }
      },
      NOW
    ).send;
    expect(over[0].seven_day_util).toBe(1);
    expect(over[0].five_hour_util).toBe(1);
    expect(over[1].five_hour_util).toBeUndefined();
    expect(over[1].five_hour_resets_at).toBeUndefined();
    for (const b of [...over, ...out.send]) expect(b.read_at).toBeGreaterThan(0);
  });

  it('says why each other account was skipped', () => {
    expect(out.skipped).toEqual([
      { label: 'aiahs', why: 'too old (21 min)' },
      { label: 'aidental', why: 'never read' },
      { label: 'aicse', why: 'no weekly reset time' },
      { label: 'aieee', why: 'no weekly %' }
    ]);
  });
});

describe('--dry', () => {
  it('prints what it would send, needs no token, makes no call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macpush-'));
    try {
      const now = new Date().toISOString();
      const path = join(dir, 'qc.json');
      writeFileSync(
        path,
        JSON.stringify({ accounts: { 'aimech@jkkn.ac.in': { seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: now } } })
      );
      const run = spawnSync(process.execPath, [SCRIPT, '--dry'], {
        encoding: 'utf8',
        // An unreachable Tower: a call would fail, and no token is set.
        env: { ...process.env, HOME: dir, QC_PATH: path, TOWER_URL: 'https://127.0.0.1:1', TOWER_USAGE_TOKEN: '' }
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/would send aimech: week 0\.85 \(resets /);
      expect(run.stdout).toMatch(/dry run: 1 to send, 0 skipped, nothing sent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
