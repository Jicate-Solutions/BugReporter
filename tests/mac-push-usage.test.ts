import { describe, it, expect } from 'vitest';
import { macReadingSchema } from '@/lib/ai-engine/mac-usage';
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
  subscription?: Sub;
};
type Sub = { plan?: string; started_on?: string; extra_use?: boolean };
type SignedIn = { email: string; subscription: Sub } | null;
const mod = (await import(pathToFileURL(SCRIPT).href)) as {
  labelOf: (e: string) => string | null;
  relativeSeconds: (t: string) => number | null;
  resetEpoch: (iso: string | undefined, rel: string, fetchedMs: number) => number | null;
  planText: (o: unknown) => string;
  indiaDay: (iso: unknown) => string | null;
  subscriptionOf: (claudeJson: unknown) => SignedIn;
  readSubscription: (path: string) => SignedIn;
  buildReadings: (
    cache: unknown,
    now: number,
    signedIn?: SignedIn
  ) => { send: Body[]; skipped: { label?: string; email?: string; why: string }[]; withheld: string[] };
  masked: (text: unknown) => string;
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
        env: { ...process.env, HOME: dir, QC_PATH: path, CLAUDE_JSON_PATH: join(dir, 'none.json'), TOWER_URL: 'https://127.0.0.1:1', TOWER_USAGE_TOKEN: '' }
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/would send aimech: week 0\.85 \(resets /);
      expect(run.stdout).toMatch(/dry run: 1 to send, 0 skipped, nothing sent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Subscription details from Claude's own settings file (22 Nov 2026): only for
 * the account signed in on the Mac, only the parts that are known, and never
 * a reason for the usage push to fail. Addresses here are made up.
 */
const at = (name: string) => [name, 'example.test'].join('@');
const oauth = (over: Record<string, unknown> = {}) => ({
  oauthAccount: {
    emailAddress: at('aimech'),
    subscriptionCreatedAt: '2024-03-05T09:15:00.000Z',
    hasExtraUsageEnabled: false,
    billingType: 'stripe_subscription',
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
    planDisplayName: 'Claude Max',
    ...over
  }
});

describe('planText', () => {
  it('names the plan from the rate-limit tier', () => {
    expect(mod.planText({ organizationRateLimitTier: 'default_claude_max_20x' })).toBe('Max 20x');
    expect(mod.planText({ organizationRateLimitTier: 'default_claude_max_5x', planDisplayName: 'Other' })).toBe('Max 5x');
  });
  it('otherwise uses the plan name, then the organisation type, 40 characters at most', () => {
    expect(mod.planText({ organizationRateLimitTier: 'default_claude_ai', planDisplayName: '  Claude Pro ' })).toBe('Claude Pro');
    expect(mod.planText({ organizationType: 'claude_team' })).toBe('claude_team');
    expect(mod.planText({ planDisplayName: 'p'.repeat(60) })).toBe('p'.repeat(40));
    expect(mod.planText({ planDisplayName: `${'p'.repeat(39)} tail` })).toBe('p'.repeat(39));
  });
  it('has no plan when nothing says one', () => {
    for (const o of [{}, null, undefined, { planDisplayName: '  ', organizationType: 7 }]) expect(mod.planText(o)).toBe('');
  });
});

describe('indiaDay', () => {
  it('gives the calendar day in India', () => {
    expect(mod.indiaDay('2024-03-05T09:15:00.000Z')).toBe('2024-03-05');
    // 20:00 UTC is already the next day in India.
    expect(mod.indiaDay('2024-03-05T20:00:00Z')).toBe('2024-03-06');
    expect(mod.indiaDay('2023-12-31T18:30:00Z')).toBe('2024-01-01');
  });
  it('has no day for anything that is not a sane moment', () => {
    for (const v of ['', 'soon', null, undefined, 1709629200000, '1990-01-01T00:00:00Z']) expect(mod.indiaDay(v)).toBeNull();
  });
});

describe('subscriptionOf', () => {
  it('reads plan, start day and paid extra use of the signed-in account', () => {
    expect(mod.subscriptionOf(oauth())).toEqual({
      email: at('aimech'),
      subscription: { plan: 'Max 20x', started_on: '2024-03-05', extra_use: false }
    });
  });
  it('keeps only the parts that are known', () => {
    expect(mod.subscriptionOf(oauth({ subscriptionCreatedAt: undefined, hasExtraUsageEnabled: 'no' }))?.subscription).toEqual({
      plan: 'Max 20x'
    });
    expect(
      mod.subscriptionOf(
        oauth({ organizationRateLimitTier: null, planDisplayName: null, organizationType: null, hasExtraUsageEnabled: true })
      )?.subscription
    ).toEqual({ started_on: '2024-03-05', extra_use: true });
  });
  it('is null with no account, no email or nothing known', () => {
    expect(mod.subscriptionOf({})).toBeNull();
    expect(mod.subscriptionOf(null)).toBeNull();
    expect(mod.subscriptionOf({ oauthAccount: 'x' })).toBeNull();
    expect(mod.subscriptionOf(oauth({ emailAddress: undefined }))).toBeNull();
    expect(mod.subscriptionOf({ oauthAccount: { emailAddress: at('aimech') } })).toBeNull();
  });
  it('lower-cases the email so it matches the cache', () => {
    expect(mod.subscriptionOf(oauth({ emailAddress: at('AiMech').toUpperCase() }))?.email).toBe(at('aimech'));
  });
});

describe('readSubscription', () => {
  it('is null, silently, for a missing file, a folder or a file that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macpush-'));
    try {
      expect(mod.readSubscription(join(dir, 'missing.json'))).toBeNull();
      expect(mod.readSubscription(dir)).toBeNull();
      writeFileSync(join(dir, 'bad.json'), '{ not json');
      expect(mod.readSubscription(join(dir, 'bad.json'))).toBeNull();
      writeFileSync(join(dir, 'ok.json'), JSON.stringify(oauth()));
      expect(mod.readSubscription(join(dir, 'ok.json'))?.subscription.plan).toBe('Max 20x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildReadings with the signed-in account', () => {
  const cache = {
    accounts: {
      [at('aimech')]: { seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: minsAgo(5) },
      [at('ainursing')]: { seven_day_pct: 40, sd_reset: 'in 3d 1h', fetched_at: minsAgo(5) }
    }
  };

  it('adds the subscription to that account only', () => {
    const { send } = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth()));
    expect(send.map((b) => b.label)).toEqual(['aimech', 'ainursing']);
    expect(send[0].subscription).toEqual({ plan: 'Max 20x', started_on: '2024-03-05', extra_use: false });
    expect('subscription' in send[1]).toBe(false);
  });

  it('adds nothing when the signed-in account is not in the cache, or there is none', () => {
    const other = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth({ emailAddress: at('director') })));
    const none = mod.buildReadings(cache, NOW, null);
    const sameNameOtherDomain = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth({ emailAddress: ['aimech', 'other.test'].join('@') })));
    for (const out of [other, none, sameNameOtherDomain, mod.buildReadings(cache, NOW)]) {
      expect(out.send).toHaveLength(2);
      for (const b of out.send) expect('subscription' in b).toBe(false);
    }
  });

  it('what it builds is always a body the Tower accepts', () => {
    const now = Date.now();
    const fresh = { accounts: { [at('aimech')]: { seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: new Date(now - 60_000).toISOString() } } };
    for (const o of [
      oauth(),
      oauth({ organizationRateLimitTier: 'x', planDisplayName: `  ${'long plan name '.repeat(8)}` }),
      oauth({ subscriptionCreatedAt: 'garbage', hasExtraUsageEnabled: null }),
      oauth({ subscriptionCreatedAt: '0001-01-01T00:00:00Z' }),
      oauth({ organizationRateLimitTier: '', planDisplayName: '', organizationType: '' })
    ]) {
      const { send } = mod.buildReadings(fresh, now, mod.subscriptionOf(o));
      expect(send[0].subscription).toBeDefined();
      expect(macReadingSchema.safeParse(send[0]).success).toBe(true);
    }
  });
});

describe('two addresses with the same name (review of #103)', () => {
  const other = (name: string) => [name, 'other.test'].join('@');
  const entry = (age = 5) => ({ seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: minsAgo(age) });
  const SUB = { plan: 'Max 20x', started_on: '2024-03-05', extra_use: false };

  it('sends the usage of both as before, and holds the subscription back for that name', () => {
    const cache = { accounts: { [at('aimech')]: entry(), [other('aimech')]: entry(), [at('ainursing')]: entry() } };
    for (const signedInAs of [at('aimech'), other('aimech')]) {
      const out = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth({ emailAddress: signedInAs })));
      expect(out.send.map((b) => b.label)).toEqual(['aimech', 'aimech', 'ainursing']);
      for (const b of out.send) expect('subscription' in b).toBe(false);
      expect(out.withheld).toEqual(['aimech']);
      // The usage bodies are exactly what they are with nobody signed in.
      expect(out.send).toEqual(mod.buildReadings(cache, NOW).send);
    }
  });

  it('a twin too old to send, or differing only in capitals, still counts as a second owner', () => {
    const stale = { accounts: { [at('aimech')]: entry(), [other('aimech')]: entry(45) } };
    const out = mod.buildReadings(stale, NOW, mod.subscriptionOf(oauth()));
    expect(out.send).toHaveLength(1);
    expect('subscription' in out.send[0]).toBe(false);
    expect(out.withheld).toEqual(['aimech']);
    const capitals = { accounts: { [at('aimech')]: entry(), [other('AiMech')]: entry() } };
    expect(mod.buildReadings(capitals, NOW, mod.subscriptionOf(oauth())).withheld).toEqual(['aimech']);
  });

  it('another account that shares no name is not held back, and nothing is withheld with nobody signed in', () => {
    const cache = { accounts: { [at('aimech')]: entry(), [other('aimech')]: entry(), [at('ainursing')]: entry() } };
    const out = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth({ emailAddress: at('ainursing') })));
    expect(out.withheld).toEqual([]);
    expect(out.send.find((b) => b.label === 'ainursing')?.subscription).toEqual(SUB);
    expect(out.send.filter((b) => b.label === 'aimech').every((b) => !('subscription' in b))).toBe(true);
    expect(mod.buildReadings(cache, NOW).withheld).toEqual([]);
    // The same address written twice in different capitals is one owner, not two.
    const once = { accounts: { [at('aimech')]: entry() } };
    expect(mod.buildReadings(once, NOW, mod.subscriptionOf(oauth({ emailAddress: at('AIMECH') }))).send[0].subscription).toEqual(SUB);
  });

  it('matches on the whole address, never on the name alone', () => {
    const cache = { accounts: { [at('aimech')]: entry() } };
    const out = mod.buildReadings(cache, NOW, mod.subscriptionOf(oauth({ emailAddress: other('aimech') })));
    expect('subscription' in out.send[0]).toBe(false);
    expect(out.withheld).toEqual([]);
  });
});

describe('what the run prints (review of #103)', () => {
  const run = (cacheText: string | null, claudeJson: unknown = null) => {
    const dir = mkdtempSync(join(tmpdir(), 'macpush-'));
    try {
      const qc = join(dir, 'qc.json');
      const cj = join(dir, 'claude.json');
      if (cacheText !== null) writeFileSync(qc, cacheText);
      if (claudeJson !== null) writeFileSync(cj, JSON.stringify(claudeJson));
      return spawnSync(process.execPath, [SCRIPT, '--dry'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: dir, QC_PATH: qc, CLAUDE_JSON_PATH: cj, TOWER_URL: 'https://127.0.0.1:1', TOWER_USAGE_TOKEN: '' }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const fresh = () => ({ seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: new Date().toISOString() });

  it('masks an address it cannot use as a name: first character and stars', () => {
    expect(mod.masked(['Some.Body', 'example.test'].join('@'))).toBe('S***');
    expect(mod.masked('')).toBe('***');
    const out = run(JSON.stringify({ accounts: { ['Some.Body@' + 'example.test']: fresh(), [at('default')]: fresh(), [at('aimech')]: fresh() } }));
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('skip S***: not a label');
    expect(out.stdout).toContain('skip d***: not a label');
    expect(out.stdout + out.stderr).not.toContain('@');
    expect(out.stdout + out.stderr).not.toContain('example.test');
    expect(out.stdout + out.stderr).not.toMatch(/Body|default/);
  });

  it('a cache that is not JSON gets a fixed message that quotes nothing from the file', () => {
    const broken = `{"accounts": {"${at('secretperson')}": oops`;
    const out = run(broken);
    expect(out.status).toBe(1);
    expect(out.stderr.trim()).toBe('cannot read the usage cache: unreadable or not JSON');
    expect(out.stdout + out.stderr).not.toMatch(/secretperson|example\.test|@|oops|position|token/i);
    const missing = run(null);
    expect(missing.status).toBe(1);
    expect(missing.stderr.trim()).toBe('cannot read the usage cache: no file');
  });

  it('says a subscription was held back for a shared name, without an address', () => {
    const cache = { accounts: { [at('aimech')]: fresh(), [['aimech', 'other.test'].join('@')]: fresh() } };
    const out = run(JSON.stringify(cache), oauth());
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('aimech: two sign-ins on this Mac share this name, so its subscription details are not sent (usage is)');
    expect(out.stdout.match(/would send aimech: week 0\.85 /g)).toHaveLength(2);
    expect(out.stdout).not.toContain('subscription: plan');
    expect(out.stdout).toMatch(/dry run: 2 to send, 0 skipped, nothing sent/);
    expect(out.stdout + out.stderr).not.toContain('@');
    expect(out.stdout + out.stderr).not.toMatch(/example\.test|other\.test/);
  });
});

describe('--dry with the signed-in account', () => {
  const dry = (claudeJson: string | null) => {
    const dir = mkdtempSync(join(tmpdir(), 'macpush-'));
    try {
      const qc = join(dir, 'qc.json');
      const cj = join(dir, 'claude.json');
      writeFileSync(
        qc,
        JSON.stringify({ accounts: { [at('aimech')]: { seven_day_pct: 85, sd_reset: 'in 9h 36m', fetched_at: new Date().toISOString() } } })
      );
      if (claudeJson !== null) writeFileSync(cj, claudeJson);
      return spawnSync(process.execPath, [SCRIPT, '--dry'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: dir, QC_PATH: qc, CLAUDE_JSON_PATH: cj, TOWER_URL: 'https://127.0.0.1:1', TOWER_USAGE_TOKEN: '' }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('prints plan, start day and extra use, and never the email', () => {
    const run = dry(JSON.stringify(oauth()));
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/would send aimech: week 0\.85 .* · subscription: plan Max 20x, started 2024-03-05, extra use off/);
    expect(run.stdout + run.stderr).not.toContain('@');
    expect(run.stdout + run.stderr).not.toContain('example.test');
  });

  it('a missing or broken file changes nothing and is not an error', () => {
    for (const content of [null, '{ broken', JSON.stringify({ oauthAccount: { emailAddress: at('someoneelse') } })]) {
      const run = dry(content);
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/would send aimech: week 0\.85 /);
      expect(run.stdout).not.toContain('subscription');
      expect(run.stderr).toBe('');
      expect(run.stdout).toMatch(/dry run: 1 to send, 0 skipped, nothing sent/);
    }
  });
});
