import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One Windows box going quiet while the other keeps working gets its own
 * email (the all-workers-down email never fires in that case), once per
 * outage, plus one "back" email.
 */

const mails: { subject: string }[] = [];
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (m: { subject: string }) => {
        mails.push(m);
        return { error: null };
      }
    };
  }
}));

import { darkHosts, runEngineWatch, BOX_DARK_AFTER_MS } from '@/lib/ai-engine/watch';

const NOW = Date.parse('2026-10-23T19:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('darkHosts', () => {
  it('names a host only when every worker on it is silent', () => {
    const runners = [
      { host: 'Biometric', last_seen_at: ago(BOX_DARK_AFTER_MS + 60_000) },
      { host: 'Biometric', last_seen_at: ago(BOX_DARK_AFTER_MS + 120_000) },
      { host: 'DESKTOP-1LB1FCS', last_seen_at: ago(30_000) },
      { host: 'DESKTOP-1LB1FCS', last_seen_at: ago(BOX_DARK_AFTER_MS + 60_000) }
    ];
    expect(darkHosts(runners, [], NOW)).toEqual(['Biometric']);
  });

  it('counts a fresh box-agent check-in as alive', () => {
    const runners = [{ host: 'Biometric', last_seen_at: ago(BOX_DARK_AFTER_MS + 60_000) }];
    const boxes = [{ host: 'Biometric', agent_seen_at: ago(60_000) }];
    expect(darkHosts(runners, boxes, NOW)).toEqual([]);
  });

  it('treats a missing check-in as silent and ignores workers with no host', () => {
    const runners = [
      { host: 'Biometric', last_seen_at: null },
      { host: null, last_seen_at: ago(BOX_DARK_AFTER_MS * 10) }
    ];
    expect(darkHosts(runners, [], NOW)).toEqual(['Biometric']);
  });

  it('is not dark just under 10 minutes', () => {
    const runners = [{ host: 'Biometric', last_seen_at: ago(BOX_DARK_AFTER_MS - 1000) }];
    expect(darkHosts(runners, [], NOW)).toEqual([]);
  });
});

/** A tiny stand-in for the database: each table returns fixed rows. */
function fakeAdmin(
  tables: Record<string, unknown[]>,
  state: { value: Record<string, unknown> },
  failing: string[] = []
) {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ['select', 'eq', 'neq', 'is', 'gt', 'lt', 'in', 'order', 'limit', 'update']) b[m] = self;
    b.maybeSingle = async () => ({ data: table === 'ai_engine_watch' ? { value: state.value } : null });
    b.upsert = async (row: { value: Record<string, unknown> }) => {
      state.value = row.value;
      return { error: null };
    };
    b.then = (res: (v: unknown) => unknown) =>
      res(
        failing.includes(table)
          ? { data: null, error: { message: 'network down' }, count: 0 }
          : { data: tables[table] ?? [], count: 0 }
      );
    return b;
  };
  return { from: builder, rpc: async () => ({ data: null }) } as unknown as SupabaseClient;
}

describe('runEngineWatch, one box dark', () => {
  beforeEach(() => {
    mails.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.AI_ALERT_EMAIL = 'director@example.com';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AI_ALERT_EMAIL;
  });

  const quietFirstBox = () => ({
    ai_runners: [
      { name: 'jicate-1', host: 'DESKTOP-1LB1FCS', last_seen_at: ago(20_000) },
      { name: 'jicate-3', host: 'Biometric', last_seen_at: ago(BOX_DARK_AFTER_MS + 60_000) }
    ],
    ai_boxes: [{ host: 'Biometric', agent_seen_at: ago(BOX_DARK_AFTER_MS + 60_000) }]
  });

  it('sends one email per outage, then one when the box is back', async () => {
    const state = { value: { last_reminder_date: '2026-10-24' } as Record<string, unknown> };

    const first = await runEngineWatch(fakeAdmin(quietFirstBox(), state), 'https://tower.test');
    expect(first.workers).toBe('up');
    expect(first.sent).toEqual(['box-dark:Biometric']);
    expect(mails[0].subject).toBe('Windows box Biometric has gone quiet');
    expect(state.value.dark_boxes).toEqual(['Biometric']);

    const again = await runEngineWatch(fakeAdmin(quietFirstBox(), state), 'https://tower.test');
    expect(again.sent).toEqual([]);

    const back = {
      ...quietFirstBox(),
      ai_boxes: [{ host: 'Biometric', agent_seen_at: ago(30_000) }]
    };
    const third = await runEngineWatch(fakeAdmin(back, state), 'https://tower.test');
    expect(third.sent).toEqual(['box-back:Biometric']);
    expect(mails[1].subject).toBe('Windows box Biometric is back');
    expect(state.value.dark_boxes).toBeUndefined();
  });

  it('keeps a dark box dark, with no false "back" email, when a read fails', async () => {
    const state = { value: { dark_boxes: ['Biometric'], last_reminder_date: '2026-10-24' } as Record<string, unknown> };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runEngineWatch(fakeAdmin(quietFirstBox(), state, ['ai_boxes']), 'https://tower.test');
    expect(r.sent).toEqual([]);
    expect(mails).toHaveLength(0);
    expect(state.value.dark_boxes).toEqual(['Biometric']);
  });

  it('sends nothing and keeps no outage when no one is set to receive alerts', async () => {
    delete process.env.AI_ALERT_EMAIL;
    const state = { value: {} as Record<string, unknown> };
    const r = await runEngineWatch(fakeAdmin(quietFirstBox(), state), 'https://tower.test');
    expect(r.sent).toEqual([]);
    expect(mails).toHaveLength(0);
    expect(state.value.dark_boxes).toBeUndefined();
  });
});
