import { describe, it, expect } from 'vitest';
import { labelsToProbe, readingStatus, windowState } from '@/lib/ai-engine/accounts';

/**
 * The accounts card tells the truth about a reading: a full account is
 * skipped on purpose until it renews, a renewed window has no current
 * reading, and "default" (each box's own sign-in) is never checked.
 */

const NOW = Date.parse('2026-11-18T07:30:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const later = (ms: number) => new Date(NOW + ms).toISOString();
const DAY = 24 * 60 * 60_000;

const acct = (label: string, five: number | null, fiveReset: string | null, week: number | null, weekReset: string | null) => ({
  label,
  priority: 1,
  five_hour_util: five,
  seven_day_util: week,
  five_hour_resets_at: fiveReset,
  seven_day_resets_at: weekReset,
  updated_at: ago(4 * DAY)
});

describe('windowState', () => {
  it('no reading', () => {
    expect(windowState(null, later(DAY), NOW)).toBe('none');
  });

  it('exactly 95% with a future reset is full', () => {
    expect(windowState(0.95, later(DAY), NOW)).toBe('full');
  });

  it('just under 95% is not full, even though it shows as 95%', () => {
    expect(windowState(0.946, later(DAY), NOW)).toBe('used');
  });

  it('a reset time equal to now counts as renewed', () => {
    expect(windowState(0.99, new Date(NOW).toISOString(), NOW)).toBe('renewed');
  });

  it('a past reset is renewed, whatever the old percentage', () => {
    expect(windowState(0.99, ago(28 * DAY), NOW)).toBe('renewed');
  });

  it('a full reading with no reset time stays full', () => {
    expect(windowState(0.97, null, NOW)).toBe('full');
  });
});

describe('readingStatus', () => {
  it('default is each box own sign-in', () => {
    expect(readingStatus(acct('default', 0.99, ago(28 * DAY), 0.99, ago(28 * DAY)), NOW)).toEqual({
      kind: 'own-signin'
    });
  });

  it('weekly full while the 5-hour window renewed: full until the weekly reset', () => {
    const r = acct('ainursing', 0.4, ago(3 * DAY), 0.96, later(DAY));
    expect(readingStatus(r, NOW)).toEqual({ kind: 'full-until', until: later(DAY) });
  });

  it('both windows full: full until the later reset', () => {
    const r = acct('aiahs', 0.97, later(60 * 60_000), 0.95, later(2 * DAY));
    expect(readingStatus(r, NOW)).toEqual({ kind: 'full-until', until: later(2 * DAY) });
  });

  it('full but renewed since: normal', () => {
    expect(readingStatus(acct('aiahs', 0.2, ago(DAY), 0.96, ago(1000)), NOW)).toEqual({ kind: 'normal' });
  });

  it('full with no reset time known: normal, never "Full until —"', () => {
    expect(readingStatus(acct('aimech', 0.2, later(DAY), 0.97, null), NOW)).toEqual({ kind: 'normal' });
  });

  it('room left: normal', () => {
    expect(readingStatus(acct('aimech', 0.2, later(DAY), 0.5, later(3 * DAY)), NOW)).toEqual({ kind: 'normal' });
  });

  it('agrees with the watch cron: anything shown as "full until" is not checked', () => {
    const rs = [
      acct('ainursing', 0.4, ago(3 * DAY), 0.96, later(DAY)),
      acct('aiahs', 0.97, later(60 * 60_000), 0.95, later(2 * DAY)),
      acct('aimech', 0.2, later(DAY), 0.5, later(3 * DAY))
    ];
    const probed = labelsToProbe(rs, rs.map((r) => r.label), NOW);
    for (const r of rs) {
      expect(probed.includes(r.label)).toBe(readingStatus(r, NOW).kind !== 'full-until');
    }
  });
});
