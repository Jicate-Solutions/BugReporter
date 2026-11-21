import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkBlocksUse,
  checkSaysUnusable,
  classifyCheck,
  enqueueAccountCheck,
  enqueueAccountProbes,
  labelsToProbe,
  pickAuto,
  readAccountChecks,
  KEY_MEMORY_MS,
  type CheckJob
} from '@/lib/ai-engine/accounts';

/**
 * What the latest check of an account said, read from the check jobs that
 * already exist (20 Nov 2026), and the rule that "auto" never moves onto an
 * account whose latest check said its key is rejected or its organisation
 * blocks Claude Code. On main, pickAuto only looked at usage readings; a
 * failed check stores no reading, so a dead key read as "empty" and was picked.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// The two failures seen live on 20 Nov 2026, word for word.
const REJECTED = 'claude error: Failed to authenticate. API Error: 401 Invalid bearer token';
const BLOCKED =
  'claude error: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const job = (status: string, error: string | null, startedMs: number): CheckJob => ({
  status,
  error,
  claimed_at: at(startedMs),
  completed_at: at(startedMs + 10_000)
});

describe('classifyCheck', () => {
  it('reads the two live failures as "key rejected" and "blocked"', () => {
    expect(classifyCheck(job('error', REJECTED, 0)).kind).toBe('key-rejected');
    expect(classifyCheck(job('error', BLOCKED, 0)).kind).toBe('blocked');
  });

  it('reads the worker\'s other key-failure wordings as "key rejected"', () => {
    expect(classifyCheck(job('error', 'claude error: OAuth access token has expired', 0)).kind).toBe('key-rejected');
    expect(classifyCheck(job('error', 'claude error: API Error: 401', 0)).kind).toBe('key-rejected');
  });

  it('a finished check that answered means the key works', () => {
    expect(classifyCheck(job('done', null, 0))).toEqual({ kind: 'working', at: at(10_000) });
  });

  it('tells a limit, a slow check and any other error apart from a bad key', () => {
    expect(classifyCheck(job('error', "claude error: You've hit your usage limit", 0)).kind).toBe('no-allowance');
    expect(classifyCheck(job('error', 'claude timed out after 60s', 0)).kind).toBe('too-slow');
    expect(classifyCheck(job('error', 'claude returned empty output', 0)).kind).toBe('failed');
  });

  it('only "key rejected" and "blocked" say the account cannot be used at all', () => {
    expect(checkBlocksUse('key-rejected')).toBe(true);
    expect(checkBlocksUse('blocked')).toBe(true);
    for (const k of ['working', 'no-allowance', 'too-slow', 'failed', 'not-checked', 'rechecking', 'checking', 'unknown'] as const) {
      expect(checkBlocksUse(k)).toBe(false);
    }
  });

  it('a check still waiting or running is not a result', () => {
    expect(classifyCheck(job('queued', null, 0)).kind).toBe('not-checked');
    expect(classifyCheck(job('running', null, 0)).kind).toBe('not-checked');
    expect(classifyCheck(null).kind).toBe('not-checked');
  });

  it('a check that started before the key was saved tested the key before it: it does not count', () => {
    expect(classifyCheck(job('error', REJECTED, -5 * MIN), at(0)).kind).toBe('not-checked');
    expect(classifyCheck(job('done', null, -5 * MIN), at(0)).kind).toBe('not-checked');
  });

  it('right after a save, a rejected key counts at once; any other failure is held back for a later check', () => {
    expect(classifyCheck(job('error', REJECTED, 1 * MIN), at(0)).kind).toBe('key-rejected');
    expect(classifyCheck(job('error', BLOCKED, 1 * MIN), at(0)).kind).toBe('rechecking');
    expect(classifyCheck(job('error', BLOCKED, KEY_MEMORY_MS + MIN), at(0)).kind).toBe('blocked');
  });

  it('right after a save, a pass is not "key works" either: the worker may still have run on the key before it', () => {
    // Before: a check that passed 20 s after the save read as "Key works" for a key nobody had tried.
    expect(classifyCheck(job('done', null, 20_000), at(0)).kind).toBe('rechecking');
    expect(classifyCheck(job('done', null, KEY_MEMORY_MS + MIN), at(0)).kind).toBe('working');
  });

  it('counts a result at once when the key log proves the check fetched the key after the save', () => {
    expect(classifyCheck(job('done', null, 20_000), at(0), true).kind).toBe('working');
    expect(classifyCheck(job('error', BLOCKED, 1 * MIN), at(0), true).kind).toBe('blocked');
    // proof never revives a check that started before the save
    expect(classifyCheck(job('done', null, -5 * MIN), at(0), true).kind).toBe('not-checked');
  });
});

// ── a small stand-in for the database ────────────────────────────────────────

type Row = Record<string, unknown>;
type Fake = {
  accounts: Row[];
  jobs: Row[];
  /** Stored keys: { label, added_at }. */
  secrets: Row[];
  /** The key log: { job_id, label, granted, fetched_at }. */
  fetches: Row[];
  failJobs?: boolean;
  failFetches?: boolean;
  jobReads: string[];
  rpc: Row[];
  rpcThrows?: boolean;
  rpcAnswer?: Row;
};

function fakeAdmin(f: Fake): SupabaseClient {
  return {
    rpc: async (_fn: string, args: Row) => {
      if (f.rpcThrows) throw new Error('down');
      f.rpc.push(args);
      return { data: f.rpcAnswer ?? { ok: true }, error: null };
    },
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let lim = Infinity;
      let desc = false;
      const col = (r: Row, c: string) => (c === 'payload->>label' ? (r.payload as { label?: string })?.label : r[c]);
      const run = () => {
        if (table === 'ai_jobs' && f.failJobs) return { data: null, error: { message: 'down' } };
        if (table === 'ai_account_key_fetches' && f.failFetches) return { data: null, error: { message: 'down' } };
        const all: Record<string, Row[]> = {
          ai_jobs: f.jobs,
          ai_accounts: f.accounts,
          ai_account_secrets: f.secrets,
          ai_account_key_fetches: f.fetches
        };
        let rows = all[table].filter((r) => filters.every((t) => t(r)));
        if (desc) rows = [...rows].sort((a, b) => (String(a.requested_at) < String(b.requested_at) ? 1 : -1));
        return { data: rows.slice(0, lim), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          if (c === 'payload->>label') f.jobReads.push(String(v));
          filters.push((r) => col(r, c) === v);
          return b;
        },
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(col(r, c))), b),
        gte: (c: string, v: string) => (filters.push((r) => String(col(r, c)) >= v), b),
        order: (_c: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false), b),
        limit: (n: number) => ((lim = n), b),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej)
      };
      return b;
    }
  } as unknown as SupabaseClient;
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const inFuture = (ms: number) => new Date(now + ms).toISOString();

/** One check job as stored, finished `msAgo` ago. */
const check = (label: string, status: string, error: string | null, msAgo: number): Row => ({
  id: `${label}-${status}-${msAgo}`,
  app_slug: 'control-tower',
  job_type: 'system.account_probe',
  payload: { label },
  status,
  error,
  requested_at: iso(msAgo + 20_000),
  claimed_at: status === 'queued' ? null : iso(msAgo + 15_000),
  completed_at: status === 'done' || status === 'error' ? iso(msAgo) : null
});

/** A usage reading; `fresh` false = no reading at all, like an account whose every check failed. */
const reading = (label: string, priority: number, week: number | null, fresh = true): Row => ({
  label,
  priority,
  five_hour_util: null,
  seven_day_util: week,
  five_hour_resets_at: null,
  seven_day_resets_at: week == null ? null : inFuture(3 * DAY),
  updated_at: fresh ? iso(5 * MIN) : null
});

const db = (over: Partial<Fake> = {}): Fake => ({
  accounts: [],
  jobs: [],
  secrets: [],
  fetches: [],
  jobReads: [],
  rpc: [],
  ...over
});

afterEach(() => vi.restoreAllMocks());

describe('pickAuto and the latest check', () => {
  it('skips an account whose key was rejected and takes the next one (main picked the rejected key)', async () => {
    // "aieee" has priority 1 and no reading (its checks all fail), so it reads as empty.
    // The working account's reading is over an hour old, so the choice goes by priority alone.
    const f = db({
      accounts: [reading('aieee', 1, null, false), { ...reading('aiahs', 3, 0.72), updated_at: iso(2 * HOUR) }],
      jobs: [check('aieee', 'error', REJECTED, 4 * MIN), check('aiahs', 'done', null, 5 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['default', 'aieee', 'aiahs'])).toBe('aiahs');
  });

  it('skips an account blocked by its organisation even though its old weekly window has renewed', async () => {
    // Live on 20 Nov: ainursing, priority 2, last reading 96% with a reset time already passed.
    const stale = { ...reading('ainursing', 2, 0.96, false), seven_day_resets_at: iso(DAY), updated_at: iso(6 * DAY) };
    const f = db({
      accounts: [reading('aimech', 1, 0.96), stale, { ...reading('aiahs', 3, 0.97) }],
      jobs: [check('ainursing', 'error', BLOCKED, 3 * MIN), check('ainursing', 'done', null, 7 * DAY)]
    });
    // aimech and aiahs are full, so by its readings alone ainursing is the only one with room.
    expect(['aimech', 'aiahs']).toContain(await pickAuto(fakeAdmin(f), ['aimech', 'ainursing', 'aiahs']));
  });

  it('looks past a check that is still waiting to the last one that finished', async () => {
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'queued', null, 0), check('aieee', 'error', REJECTED, 6 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aiece');
  });

  it('does not forget a failed check after a few hours (an account can go unchecked for days)', async () => {
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'error', REJECTED, 3 * DAY)]
    });
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aiece');
  });

  it('takes the account back once a later check of it succeeds', async () => {
    const f = db({
      accounts: [reading('aieee', 1, 0.1), reading('aiece', 2, 0.1)],
      jobs: [check('aieee', 'error', REJECTED, 30 * MIN), check('aieee', 'done', null, 2 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aieee');
  });

  it('a slow or otherwise failed check does not take an account out of the choice', async () => {
    const f = db({
      accounts: [reading('aimech', 1, 0.1), reading('aiahs', 2, 0.1)],
      jobs: [check('aimech', 'error', 'claude timed out after 60s', 2 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['aimech', 'aiahs'])).toBe('aimech');
  });

  it('never drops the box\'s own sign-in, and reads no check for it', async () => {
    const f = db({ accounts: [reading('default', 1, 0.1), reading('aiahs', 2, 0.1)] });
    expect(await pickAuto(fakeAdmin(f), ['default', 'aiahs'])).toBe('default');
    expect(f.jobReads).toEqual([]);
  });

  it('keeps the last account standing, so a box is never left without an answer', async () => {
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'error', REJECTED, 4 * MIN), check('aiece', 'error', REJECTED, 4 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aiece');
    expect(await pickAuto(fakeAdmin(f), ['aieee'])).toBe('aieee');
  });

  it('when the checks cannot be read, the choice stays as it was, and the logs say so', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'error', REJECTED, 4 * MIN)],
      failJobs: true
    });
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aieee');
    expect(await checkSaysUnusable(fakeAdmin(f), 'aieee', now)).toBe(false);
    // Before: this switched the rule off with nothing in the logs.
    expect(logged).toHaveBeenCalledTimes(2);
    expect(String(logged.mock.calls[0][0])).toContain('last check not read');
  });

  it('a rejection of the key BEFORE the one stored now does not shut the repaired account out', async () => {
    // Rejected an hour ago; a new key was saved a minute ago and its own check has not finished yet.
    // Before: the old rejection still counted, so "auto" passed over the just-repaired priority-1 account.
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'queued', null, 0), check('aieee', 'error', REJECTED, 60 * MIN)],
      secrets: [{ label: 'aieee', added_at: iso(MIN) }]
    });
    expect(await checkSaysUnusable(fakeAdmin(f), 'aieee', now)).toBe(false);
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aieee');
  });

  it('a rejection of the key stored now still shuts the account out, also right after the save', async () => {
    const f = db({
      accounts: [reading('aieee', 1, null, false), reading('aiece', 2, null, false)],
      jobs: [check('aieee', 'error', REJECTED, MIN)],
      secrets: [{ label: 'aieee', added_at: iso(3 * MIN) }]
    });
    expect(await checkSaysUnusable(fakeAdmin(f), 'aieee', now)).toBe(true);
    expect(await pickAuto(fakeAdmin(f), ['aieee', 'aiece'])).toBe('aiece');
  });

  it('reads one check in the usual case (this runs on every worker poll)', async () => {
    const f = db({
      accounts: [reading('aiahs', 1, 0.5), reading('aieee', 2, null, false)],
      jobs: [check('aiahs', 'done', null, 2 * MIN), check('aieee', 'error', REJECTED, 4 * MIN)]
    });
    expect(await pickAuto(fakeAdmin(f), ['default', 'aiahs', 'aieee'])).toBe('aiahs');
    expect(f.jobReads).toEqual(['aiahs']);
  });
});

describe('readAccountChecks (for the card)', () => {
  it('gives the latest finished check of each stored key in plain kinds', async () => {
    const f = db({
      jobs: [
        check('aieee', 'queued', null, 0),
        check('aieee', 'error', REJECTED, 6 * MIN),
        check('ainursing', 'error', BLOCKED, 4 * MIN),
        check('aiahs', 'done', null, 9 * MIN)
      ]
    });
    const old = iso(20 * DAY);
    const out = await readAccountChecks(
      fakeAdmin(f),
      ['aieee', 'ainursing', 'aiahs', 'aimech'].map((label) => ({ label, added_at: old })),
      now
    );
    expect(out.get('aieee')?.kind).toBe('key-rejected');
    expect(out.get('ainursing')?.kind).toBe('blocked');
    expect(out.get('aiahs')).toEqual({ kind: 'working', at: f.jobs[3].completed_at });
    expect(out.get('aimech')?.kind).toBe('not-checked');
  });

  it('says "checking" for a key just saved whose check is waiting, ignoring the old key\'s result', async () => {
    const f = db({ jobs: [check('aieee', 'queued', null, 0), check('aieee', 'error', REJECTED, 6 * MIN)] });
    const out = await readAccountChecks(fakeAdmin(f), [{ label: 'aieee', added_at: iso(MIN) }], now);
    expect(out.get('aieee')).toEqual({ kind: 'checking', at: null });
  });

  it('says "unknown" when the checks cannot be read, never a made-up result, and the logs say so', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = db({ failJobs: true });
    const out = await readAccountChecks(fakeAdmin(f), [{ label: 'aieee', added_at: null }], now);
    expect(out.get('aieee')).toEqual({ kind: 'unknown', at: null });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  describe('a key replaced while a worker still remembers the one before it', () => {
    // The key was saved 2 minutes ago; the check queued at once passed a minute ago.
    const passed = check('aiahs', 'done', null, MIN);
    const keys = [{ label: 'aiahs', added_at: iso(2 * MIN) }];

    it('does not say "key works" when the check did not fetch the key after the save', async () => {
      // Before: "Key works" for a new key that no worker had tried.
      const f = db({ jobs: [passed] });
      expect((await readAccountChecks(fakeAdmin(f), keys, now)).get('aiahs')?.kind).toBe('rechecking');
    });

    it('a fetch from before the save, or by another check, is not proof', async () => {
      const f = db({
        jobs: [passed],
        fetches: [
          { job_id: passed.id, label: 'aiahs', granted: true, fetched_at: iso(9 * MIN) },
          { job_id: 'another-job', label: 'aiahs', granted: true, fetched_at: iso(MIN) },
          { job_id: passed.id, label: 'aiahs', granted: false, fetched_at: iso(MIN) }
        ]
      });
      expect((await readAccountChecks(fakeAdmin(f), keys, now)).get('aiahs')?.kind).toBe('rechecking');
    });

    it('says "key works" at once when the key log shows this check fetched the key after the save', async () => {
      const f = db({
        jobs: [passed],
        fetches: [{ job_id: passed.id, label: 'aiahs', granted: true, fetched_at: iso(MIN + 12_000) }]
      });
      expect((await readAccountChecks(fakeAdmin(f), keys, now)).get('aiahs')).toEqual({
        kind: 'working',
        at: passed.completed_at
      });
    });

    it('stays unproven when the key log cannot be read', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const f = db({
        jobs: [passed],
        fetches: [{ job_id: passed.id, label: 'aiahs', granted: true, fetched_at: iso(MIN + 12_000) }],
        failFetches: true
      });
      expect((await readAccountChecks(fakeAdmin(f), keys, now)).get('aiahs')?.kind).toBe('rechecking');
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});

describe('labelsToProbe after a key was saved', () => {
  // An account kept up to date by real jobs: its reading is 2 minutes old, so the usual rule skips it.
  const busy = { ...reading('aiahs', 1, 0.4), updated_at: iso(2 * MIN) };
  const saved = (msAgo: number) => new Map([['aiahs', iso(msAgo)]]);

  it('checks a key again 10 to 20 minutes after it was saved, whatever the age of its reading', () => {
    // Before: no check came while the reading stayed fresh, so "still checking" never ended.
    expect(labelsToProbe([busy] as never, ['aiahs'], now, saved(12 * MIN))).toEqual(['aiahs']);
    expect(labelsToProbe([busy] as never, ['aiahs'], now, saved(19 * MIN))).toEqual(['aiahs']);
  });

  it('not sooner (a worker may still remember the key before it) and not later', () => {
    expect(labelsToProbe([busy] as never, ['aiahs'], now, saved(5 * MIN))).toEqual([]);
    expect(labelsToProbe([busy] as never, ['aiahs'], now, saved(25 * MIN))).toEqual([]);
    expect(labelsToProbe([busy] as never, ['aiahs'], now)).toEqual([]);
  });

  it('still skips an account that reads full: checking it would only hit the limit', () => {
    const full = { ...reading('aiahs', 1, 0.97), updated_at: iso(2 * MIN) };
    expect(labelsToProbe([full] as never, ['aiahs'], now, saved(12 * MIN))).toEqual([]);
  });

  it('the watch round passes each key\'s save time on: it queues that one check, and none for an old key', async () => {
    const f = db({ accounts: [busy], secrets: [{ label: 'aiahs', added_at: iso(12 * MIN) }] });
    expect(await enqueueAccountProbes(fakeAdmin(f))).toEqual(['aiahs']);
    expect(f.rpc).toHaveLength(1);
    expect(f.rpc[0]).toMatchObject({ p_job_type: 'system.account_probe', p_payload: { label: 'aiahs' } });

    const old = db({ accounts: [busy], secrets: [{ label: 'aiahs', added_at: iso(30 * DAY) }] });
    expect(await enqueueAccountProbes(fakeAdmin(old))).toEqual([]);
    expect(old.rpc).toHaveLength(0);
  });
});

describe('enqueueAccountCheck', () => {
  it('queues one check of that account, ahead of ordinary background jobs', async () => {
    const f = db();
    expect(await enqueueAccountCheck(fakeAdmin(f), 'aieee')).toBe(true);
    expect(f.rpc).toEqual([
      {
        p_job_type: 'system.account_probe',
        p_application_id: null,
        p_app_slug: 'control-tower',
        p_organization_id: null,
        p_payload: { label: 'aieee' },
        p_dedupe_key: 'probe:aieee',
        p_priority: 50
      }
    ]);
  });

  it('never throws: saving a key must not fail because the check could not be queued', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await enqueueAccountCheck(fakeAdmin(db({ rpcThrows: true })), 'aieee')).toBe(false);
  });

  it('says no when the queue refuses the check (the check task is switched off)', async () => {
    const f = db({ rpcAnswer: { ok: false, error: 'task_switched_off' } });
    expect(await enqueueAccountCheck(fakeAdmin(f), 'aieee')).toBe(false);
  });

  it('says no when it was merged into a check already waiting or running, which may be of the key before', async () => {
    // Before: this counted as "checking the key now" although no new check was queued.
    const f = db({ rpcAnswer: { ok: true, job_id: 'older-check', deduped: true } });
    expect(await enqueueAccountCheck(fakeAdmin(f), 'aieee')).toBe(false);
  });
});
