import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chooseAccount, labelsToProbe, FRESH_MS, PROBE_AFTER_MS } from '@/lib/ai-engine/accounts';
import { claimEngineJob } from '@/lib/ai-engine/engine';

/**
 * Auto picks only accounts it has heard from in the last hour while one of
 * them fits, and the watch cron checks stored accounts that are due.
 */

const NOW = Date.parse('2026-10-23T13:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const later = (ms: number) => new Date(NOW + ms).toISOString();

const reading = (label: string, priority: number, five: number, week: number, updatedAgo: number | null) => ({
  label,
  priority,
  five_hour_util: five,
  seven_day_util: week,
  five_hour_resets_at: later(60 * 60_000),
  seven_day_resets_at: later(3 * 24 * 60 * 60_000),
  updated_at: updatedAgo == null ? null : ago(updatedAgo)
});

describe('chooseAccount', () => {
  const labels = ['default', 'aimech', 'aiahs'];

  it('keeps priority 1 while it has room and is fresh', () => {
    const r = [reading('aimech', 1, 0.1, 0.2, 60_000), reading('aiahs', 2, 0.1, 0.1, 60_000)];
    expect(chooseAccount(r, labels, NOW)).toBe('aimech');
  });

  it('moves to the next fresh account when priority 1 is full', () => {
    const r = [reading('aimech', 1, 0.97, 0.5, 60_000), reading('aiahs', 2, 0.1, 0.1, 60_000)];
    expect(chooseAccount(r, labels, NOW)).toBe('aiahs');
  });

  it('skips an account not heard from in an hour while a fresh one fits', () => {
    const r = [
      reading('aimech', 1, 0.97, 0.5, 60_000),
      reading('aiahs', 2, 0.1, 0.1, FRESH_MS + 60_000),
      { ...reading('default', 3, 0.1, 0.1, 60_000) }
    ];
    expect(chooseAccount(r, labels, NOW)).toBe('default');
  });

  it('falls back to the old rule when no fresh account fits, so a box is never stranded', () => {
    const r = [reading('aimech', 1, 0.97, 0.5, 60_000), reading('aiahs', 2, 0.1, 0.1, FRESH_MS + 60_000)];
    expect(chooseAccount(r, ['aimech', 'aiahs'], NOW)).toBe('aiahs');
  });

  it('counts a full reading as empty once its window renewed', () => {
    const r = [
      { ...reading('aimech', 1, 0.99, 0.2, 60_000), five_hour_resets_at: ago(1000) },
      reading('aiahs', 2, 0.1, 0.1, 60_000)
    ];
    expect(chooseAccount(r, ['aimech', 'aiahs'], NOW)).toBe('aimech');
  });

  it('when all are full, picks the one that renews first', () => {
    const r = [
      { ...reading('aimech', 1, 0.99, 0.2, 60_000), five_hour_resets_at: later(2 * 60 * 60_000) },
      { ...reading('aiahs', 2, 0.99, 0.2, 60_000), five_hour_resets_at: later(30 * 60_000) }
    ];
    expect(chooseAccount(r, ['aimech', 'aiahs'], NOW)).toBe('aiahs');
  });
});

describe('labelsToProbe', () => {
  it('checks stored accounts with an old or missing reading', () => {
    const r = [reading('aimech', 1, 0.1, 0.1, PROBE_AFTER_MS + 1000), reading('aiahs', 2, 0.1, 0.1, 60_000)];
    expect(labelsToProbe(r, ['aimech', 'aiahs', 'newone'], NOW)).toEqual(['aimech', 'newone']);
  });

  it('never checks "default", which is a different account on each box', () => {
    expect(labelsToProbe([], ['default', 'aimech'], NOW)).toEqual(['aimech']);
  });

  it('skips an account read as full until its window renews', () => {
    const full = reading('aimech', 1, 0.2, 0.99, PROBE_AFTER_MS + 1000);
    expect(labelsToProbe([full], ['aimech'], NOW)).toEqual([]);
    expect(labelsToProbe([{ ...full, seven_day_resets_at: ago(1000) }], ['aimech'], NOW)).toEqual(['aimech']);
  });
});

describe('claimEngineJob account pin', () => {
  function fakeAdmin(job: Record<string, unknown>) {
    return {
      rpc: async () => ({
        data: {
          job,
          spec: { instructions: 'Reply ok', model: 'haiku', output_format: 'text', timeout_seconds: 60, max_answer_words: 5 }
        },
        error: null
      }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { effort: null } }) }) }) })
    } as unknown as SupabaseClient;
  }

  it('pins a Control Tower check job to the account it names', async () => {
    const out = await claimEngineJob(
      fakeAdmin({ id: 'j1', job_type: 'system.account_probe', app_slug: 'control-tower', attempts: 1, payload: { label: 'aiahs' } }),
      'jicate-3'
    );
    expect(out?.account_pin).toBe('aiahs');
  });

  it('ignores a pin on a job any app could have queued', async () => {
    const out = await claimEngineJob(
      fakeAdmin({ id: 'j2', job_type: 'system.account_probe', app_slug: 'plug-the-leak', attempts: 1, payload: { label: 'aiahs' } }),
      'jicate-3'
    );
    expect(out?.account_pin).toBeNull();
    const other = await claimEngineJob(
      fakeAdmin({ id: 'j3', job_type: 'leak.coach', app_slug: 'control-tower', attempts: 1, payload: { label: 'aiahs' } }),
      'jicate-3'
    );
    expect(other?.account_pin).toBeNull();
  });
});
