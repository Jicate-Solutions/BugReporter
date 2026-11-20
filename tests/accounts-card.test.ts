import { describe, it, expect } from 'vitest';
import type { CheckResult } from '@/lib/ai-engine/accounts';
import {
  accountViews,
  boxLines,
  boxName,
  cardIsSettling,
  needsAutoPick,
  usedBy,
  KEY_SETTLE_MS,
  type AccountInput,
  type BoxRow
} from '@/lib/ai-engine/accounts-card';

/**
 * The "Claude accounts" card (Director, 20 Nov 2026): each account says who is
 * using it now and what its last check said; every box in the boxes table gets
 * a line, also one with no JICATE worker; "default" is never an account row,
 * it is a box's own Windows sign-in.
 */

const NOW = Date.parse('2026-11-20T17:45:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const later = (ms: number) => new Date(NOW + ms).toISOString();

const box = (host: string, over: Partial<BoxRow> = {}): BoxRow => ({
  host,
  account: 'aiahs',
  chosen_label: 'aiahs',
  applied_label: 'aiahs',
  applied_at: ago(6 * 60 * MIN),
  agent_seen_at: ago(30_000),
  ...over
});

/** A worker as the workers table holds it, with the stale "account of its last job" column. */
const worker = (name: string, host: string | null, account: string | null = 'auto', seenAgo = 5_000) => ({
  name,
  host,
  account,
  last_seen_at: ago(seenAgo),
  account_in_use: 'aimech'
});

// The live shape on 20 Nov: Box 1 has a row and no JICATE worker; Box 2 is on "auto" with four workers.
const LIVE_BOXES = [box('Biometric'), box('DESKTOP-1LB1FCS', { account: 'auto' })];
const LIVE_WORKERS = ['jicate-1', 'jicate-2', 'jicate-3', 'jicate-4'].map((n) => worker(n, 'DESKTOP-1LB1FCS'));

describe('boxLines', () => {
  it('gives a box with no JICATE worker its own line (the old list was built from workers only)', () => {
    const lines = boxLines([box('Biometric')], [], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ host: 'Biometric', name: 'Box 1', workers: [], setting: 'aiahs', on: 'aiahs' });
    expect(lines[0].sentence).toContain('On aiahs now, chosen by hand.');
  });

  it('names the boxes the way the Director does, and any other computer by its own name', () => {
    expect(boxName('Biometric')).toBe('Box 1');
    expect(boxName('desktop-1lb1fcs')).toBe('Box 2');
    expect(boxName('LAB-PC-7')).toBe('LAB-PC-7');
  });

  it('merges a box and its workers whatever the capital letters, keeping the boxes-table spelling', () => {
    const lines = boxLines([box('Biometric')], [worker('jicate-9', 'BIOMETRIC')], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0].host).toBe('Biometric');
    expect(lines[0].workers).toEqual(['jicate-9']);
  });

  it('still lists a computer that only has workers and no box row', () => {
    const lines = boxLines([], [worker('jicate-1', 'LAB-PC-7', null)], NOW);
    expect(lines[0]).toMatchObject({ host: 'LAB-PC-7', name: 'LAB-PC-7', helper: 'none', setting: 'default' });
    expect(lines[0].sentence).toContain("They are on the box's own Windows sign-in.");
  });

  it('says a box is on its own Windows sign-in, never the stored word "default"', () => {
    const [line] = boxLines([box('Biometric', { account: 'default', chosen_label: null, applied_label: 'default' })], [], NOW);
    expect(line.sentence).toContain('On its own Windows sign-in now, chosen by hand.');
    expect(line.sentence).not.toContain('default');
  });

  it('says what "auto" picked, and when a switch is still on its way', () => {
    const [auto] = boxLines([box('DESKTOP-1LB1FCS', { account: 'auto' })], [], NOW);
    expect(auto.sentence).toContain('On aiahs now, picked by "auto".');
    const [moving] = boxLines([box('Biometric', { account: 'aimech', chosen_label: null })], [], NOW);
    expect(moving.sentence).toContain('On aiahs now. Switching to aimech (chosen by hand), usually within a minute.');
  });

  it('says how long the box has been on its account, not when it "last confirmed" it', () => {
    // The helper reports its account on a switch and with its file reports, not every minute:
    // "last confirmed 6 h ago" next to "helper last seen 30s ago" read like a stale box.
    const [line] = boxLines([box('Biometric')], [], NOW);
    expect(line.sentence).toBe(
      'On aiahs now, chosen by hand. It has been on this for at least 6 h. Box helper last seen 30s ago. Claude tabs pick up a switch when reopened.'
    );
  });

  it('a box row no helper has ever called in from, with no worker, says so', () => {
    const [line] = boxLines([box('LAB-PC-7', { agent_seen_at: null, applied_label: null, applied_at: null })], [], NOW);
    expect(line).toMatchObject({ helper: 'none', on: undefined, workers: [] });
    expect(line.sentence).toBe('No box helper has checked in from this computer yet.');
  });

  it('a helper that has not reported its account yet: says so, and where the box should move', () => {
    const [chosen] = boxLines([box('Biometric', { applied_label: null, applied_at: null })], [], NOW);
    expect(chosen.sentence).toContain('The box has not said which account it is on yet. It should move to aiahs within a minute.');
    const [none] = boxLines([box('Biometric', { account: null, chosen_label: null, applied_label: null, applied_at: null })], [], NOW);
    expect(none.sentence).toContain('The box has not said which account it is on yet. Box helper last seen');
  });

  it('a box with no choice made in the Tower says so', () => {
    const [line] = boxLines([box('Biometric', { account: null, chosen_label: null })], [], NOW);
    expect(line.setting).toBeNull();
    expect(line.sentence).toContain('On aiahs now. No account has been chosen for this box here.');
  });

  it('shows no shared setting when a computer\'s workers are set differently', () => {
    const [line] = boxLines([], [worker('jicate-1', 'LAB-PC-7', 'aiahs'), worker('jicate-2', 'LAB-PC-7', 'aimech')], NOW);
    expect(line.setting).toBeNull();
    expect(line.sentence).toBe(
      'The box helper is not installed on this computer yet, so only its JICATE workers follow the choice made here.'
    );
  });

  it('says so when the box helper has gone quiet', () => {
    const [line] = boxLines([box('Biometric', { agent_seen_at: ago(40 * MIN) })], [], NOW);
    expect(line.helper).toBe('silent');
    expect(line.sentence).toBe('Box helper not heard from for 40 min, so this may be out of date. The box was last on aiahs.');
  });

  it('sorts Box 1 before Box 2', () => {
    expect(boxLines([...LIVE_BOXES].reverse(), LIVE_WORKERS, NOW).map((l) => l.name)).toEqual(['Box 1', 'Box 2']);
  });
});

describe('usedBy (who is using an account right now)', () => {
  it('names each box on the account, with its workers (the live shape on 20 Nov)', () => {
    const lines = boxLines(LIVE_BOXES, LIVE_WORKERS, NOW);
    expect(usedBy('aiahs', lines)).toEqual({ inUse: true, text: 'In use by Box 1 and Box 2 (4 workers)' });
  });

  it('ignores the stale "account of the last job" column (every worker said aimech while the box was on aiahs)', () => {
    const lines = boxLines(LIVE_BOXES, LIVE_WORKERS, NOW);
    expect(usedBy('aimech', lines)).toEqual({ inUse: false, text: 'Not in use now' });
  });

  it('does not count a box whose helper has gone quiet, but still names its live workers', () => {
    const lines = boxLines(
      [box('DESKTOP-1LB1FCS', { agent_seen_at: ago(40 * MIN) })],
      [worker('jicate-1', 'DESKTOP-1LB1FCS'), worker('jicate-2', 'DESKTOP-1LB1FCS', 'auto', 10 * MIN)],
      NOW
    );
    expect(usedBy('aiahs', lines).text).toBe('In use by worker jicate-1 on Box 2');
  });

  it('names workers that are on a different account from their box (a switch on its way)', () => {
    const lines = boxLines([box('DESKTOP-1LB1FCS', { account: 'aimech', chosen_label: null })], LIVE_WORKERS, NOW);
    expect(usedBy('aiahs', lines).text).toBe('In use by Box 2');
    expect(usedBy('aimech', lines).text).toBe('In use by workers jicate-1, jicate-2, jicate-3, jicate-4 on Box 2');
  });

  it('a worker on its own "auto" setting counts on what the chooser gives it, when the page asked', () => {
    const workers = [worker('jicate-1', 'LAB-PC-7', 'auto')];
    expect(needsAutoPick([], workers)).toBe(true);
    expect(needsAutoPick(LIVE_BOXES, LIVE_WORKERS)).toBe(false); // the box's choice decides
    expect(usedBy('aiahs', boxLines([], workers, NOW, 'aiahs')).text).toBe('In use by worker jicate-1 on LAB-PC-7');
    expect(usedBy('aiahs', boxLines([], workers, NOW)).inUse).toBe(false);
  });
});

const account = (label: string, over: Partial<AccountInput> = {}): AccountInput => ({
  label,
  five_hour_util: null,
  seven_day_util: null,
  five_hour_resets_at: null,
  seven_day_resets_at: null,
  updated_at: null,
  ...over
});
const checks = (entries: Record<string, CheckResult['kind']>, at: string | null = ago(5 * MIN)) =>
  new Map<string, CheckResult>(Object.entries(entries).map(([l, kind]) => [l, { kind, at }]));

describe('accountViews', () => {
  const lines = boxLines(LIVE_BOXES, LIVE_WORKERS, NOW);

  it('leaves "default" out of the account list: it is a box\'s own sign-in, not an account', () => {
    const views = accountViews([account('default'), account('aiahs')], checks({ aiahs: 'working' }), lines, NOW);
    expect(views.map((v) => v.label)).toEqual(['aiahs']);
  });

  it('shows a rejected key in plain words instead of "not used yet"', () => {
    const [v] = accountViews([account('aieee')], checks({ aieee: 'key-rejected' }), lines, NOW);
    expect(v.status.tone).toBe('bad');
    expect(v.status.text).toBe(
      'Key rejected: Claude does not accept this key. Add the account again below with the long key (it starts with sk-ant-oat01-). Checked 5 min ago.'
    );
    expect(v.badges).toEqual([{ tone: 'red', text: 'Key rejected' }]);
    expect(v.usedBy).toBe('Not in use now');
  });

  it('shows an account blocked by its organisation, and hides its old usage bars', () => {
    const stale = account('ainursing', { seven_day_util: 0.96, seven_day_resets_at: ago(DAY), updated_at: ago(6 * DAY) });
    const [v] = accountViews([stale], checks({ ainursing: 'blocked' }), lines, NOW);
    expect(v.status.text).toContain("Blocked: this account's organisation has switched off Claude Code.");
    expect(v.badges).toEqual([{ tone: 'red', text: 'Blocked' }]);
    expect(v.showBars).toBe(false);
  });

  it('shows a working account in use, with its bars', () => {
    const a = account('aiahs', { seven_day_util: 0.72, seven_day_resets_at: later(5 * DAY), updated_at: ago(10 * MIN) });
    const [v] = accountViews([a], checks({ aiahs: 'working' }), lines, NOW);
    expect(v).toMatchObject({
      inUse: true,
      usedBy: 'In use by Box 1 and Box 2 (4 workers)',
      status: { tone: 'ok', text: 'Key works. Checked 5 min ago.' },
      badges: [{ tone: 'green', text: 'In use' }],
      showBars: true
    });
  });

  it('says a full account is skipped on purpose until it resets', () => {
    const a = account('aimech', { seven_day_util: 0.96, seven_day_resets_at: '2026-11-25T17:00:00Z', updated_at: ago(9 * 60 * MIN) });
    const [v] = accountViews([a], checks({ aimech: 'working' }, ago(9 * 60 * MIN)), lines, NOW);
    expect(v.status.text).toMatch(/^Key works\. Full until Wed, 10:30 pm\. Checked again automatically right after it resets\.$/i);
    expect(v.badges).toEqual([{ tone: 'amber', text: 'Full' }]);
  });

  it('says when a key is being checked, and when no key is saved here at all', () => {
    const views = accountViews(
      [account('new1'), account('new2'), account('new3'), account('local')],
      checks({ new1: 'checking', new2: 'rechecking', new3: 'not-checked' }, null),
      lines,
      NOW
    );
    expect(views.map((v) => v.status.text)).toEqual([
      'Checking this key now. The result shows here in about a minute.',
      'Still checking this key. The result should show here within about 15 minutes.',
      // no time is promised: an account kept up to date by real jobs is not checked separately
      'No recent check of this key.',
      'No key saved in the Control Tower.'
    ]);
    expect(views.every((v) => v.badges.length === 0)).toBe(true);
  });

  it('a full account never promises a check: it is skipped on purpose until it resets', () => {
    // Before: "Still checking this key. The result shows here within about 15 minutes." beside a "Full" badge, for days.
    const a = account('aimech', { seven_day_util: 0.96, seven_day_resets_at: '2026-11-25T17:00:00Z', updated_at: ago(9 * 60 * MIN) });
    for (const kind of ['rechecking', 'not-checked'] as const) {
      const [v] = accountViews([a], checks({ aimech: kind }, null), lines, NOW);
      expect(v.status.text).toMatch(/^Full until Wed, 10:30 pm\. Checked again automatically right after it resets\.$/i);
      expect(v.badges).toEqual([{ tone: 'amber', text: 'Full' }]);
    }
  });

  it('tells a check that failed for another reason apart from a bad key', () => {
    const views = accountViews([account('a'), account('b')], checks({ a: 'too-slow', b: 'failed' }), lines, NOW);
    expect(views[0].status.text).toBe('Check failed: it took too long. It is checked again automatically. Last tried 5 min ago.');
    expect(views[1].status.text).toBe('Check failed: Claude gave an error. It is checked again automatically. Last tried 5 min ago.');
    // amber and plain, never red: the check went wrong, the account was not proved unusable
    expect(views.map((v) => v.badges)).toEqual([[{ tone: 'amber', text: 'Check failed' }], [{ tone: 'amber', text: 'Check failed' }]]);
    expect(views.map((v) => v.status.tone)).toEqual(['plain', 'plain']);
  });

  it('one slow or failed check does not hide a working account\'s current usage', () => {
    // Before: an account in use, read 3 minutes ago by a real job, lost its bars and went red on one timed-out check.
    const a = account('aiahs', { seven_day_util: 0.72, seven_day_resets_at: later(5 * DAY), updated_at: ago(3 * MIN) });
    for (const kind of ['too-slow', 'failed'] as const) {
      const [v] = accountViews([a], checks({ aiahs: kind }), lines, NOW);
      expect(v.showBars).toBe(true);
      expect(v.badges).toEqual([{ tone: 'green', text: 'In use' }, { tone: 'amber', text: 'Check failed' }]);
    }
    // a key Claude refuses still hides the old bars
    expect(accountViews([a], checks({ aiahs: 'key-rejected' }), lines, NOW)[0].showBars).toBe(false);
  });

  it('never shows raw error text or a stored word', () => {
    const kinds: CheckResult['kind'][] = ['working', 'key-rejected', 'blocked', 'no-allowance', 'too-slow', 'failed', 'not-checked', 'rechecking', 'checking', 'unknown'];
    const views = accountViews(kinds.map((k) => account(k)), checks(Object.fromEntries(kinds.map((k) => [k, k]))), lines, NOW);
    for (const v of views) {
      expect(v.status.text).not.toMatch(/401|bearer|claude error|default|ai_|probe/i);
      expect(v.status.text.length).toBeGreaterThan(10);
    }
  });
});

describe('cardIsSettling (the page re-reads itself after "Add account")', () => {
  const saved = (msAgo: number) => [{ label: 'aieee', added_at: ago(msAgo) }];

  it('is true while a key saved a moment ago has no result yet', () => {
    expect(cardIsSettling(saved(2 * MIN), checks({ aieee: 'checking' }, null), NOW)).toBe(true);
    expect(cardIsSettling(saved(2 * MIN), checks({ aieee: 'not-checked' }, null), NOW)).toBe(true);
    expect(cardIsSettling(saved(2 * MIN), checks({ aieee: 'rechecking' }), NOW)).toBe(true);
  });

  it('stops as soon as a result is in, good or bad', () => {
    expect(cardIsSettling(saved(2 * MIN), checks({ aieee: 'working' }), NOW)).toBe(false);
    expect(cardIsSettling(saved(2 * MIN), checks({ aieee: 'key-rejected' }), NOW)).toBe(false);
  });

  it('stops by itself after 20 minutes, so a switched-off worker box cannot keep the page refreshing', () => {
    expect(cardIsSettling(saved(KEY_SETTLE_MS + MIN), checks({ aieee: 'checking' }, null), NOW)).toBe(false);
  });

  it('is false for old keys and for keys with no save time', () => {
    expect(cardIsSettling([{ label: 'aiahs', added_at: null }], checks({ aiahs: 'not-checked' }, null), NOW)).toBe(false);
    expect(cardIsSettling(saved(30 * DAY), checks({ aieee: 'not-checked' }, null), NOW)).toBe(false);
  });
});
