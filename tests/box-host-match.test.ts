import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One computer, two spellings (review of #99): the box helper saved Box 1 as
 * "Biometric", a worker may report "biometric". The card already merged them
 * into one line, but the switch behind it updated workers by the exact
 * spelling, and a worker asking for its box's account looked the box up by the
 * exact spelling too. So a worker with other capitals did not follow the box.
 * Now both match without regard to capitals, and every row keeps its spelling.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  fail: null as string | null
}));

/** A small stand-in for the database: exact matches only, like the real one. */
function fakeAdmin() {
  return {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let orderBy: string | null = null;
      let lim = Infinity;
      const run = () => {
        if (db.fail === table) return { data: null, error: { message: 'down' } };
        let rows = (db.tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        // Plain byte order here. The real database has its own name order; either way it is the same on every poll.
        const by = orderBy;
        if (by) rows = [...rows].sort((a, b) => (String(a[by]) < String(b[by]) ? -1 : 1));
        return { data: rows.slice(0, lim), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        order: (c: string) => ((orderBy = c), b),
        limit: (n: number) => ((lim = n), b),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        update: (row: Row) => ((patch = row), b),
        upsert: async (row: Row, o: { onConflict: string }) => {
          const hit = (db.tables[table] ??= []).find((r) => r[o.onConflict] === row[o.onConflict]);
          if (hit) Object.assign(hit, row);
          else db.tables[table].push({ ...row });
          return { error: null };
        },
        maybeSingle: async () => {
          const r = run();
          return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej)
      };
      return b;
    }
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock('@/lib/ai-engine/admin', () => ({ isSuperAdmin: vi.fn(async () => true) }));

const { PATCH } = await import('@/app/api/internal/ai-engine/boxes/route');
const { findHost, resolveBoxAccount, sameHost } = await import('@/lib/ai-engine/accounts');

const patch = (body: Row) =>
  PATCH(
    new NextRequest('https://tower.example.com/api/internal/ai-engine/boxes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );

const runner = (name: string) => db.tables.ai_runners.find((r) => r.name === name)!;

beforeEach(() => {
  db.fail = null;
  db.tables = {
    ai_account_secrets: [{ label: 'aiahs' }, { label: 'aiece' }],
    ai_boxes: [
      { host: 'Biometric', account: 'aiahs', chosen_label: null },
      { host: 'DESKTOP-1LB1FCS', account: 'auto', chosen_label: 'aiahs' }
    ],
    ai_runners: [
      { name: 'w-1', host: 'biometric', account: 'aiahs' },
      { name: 'w-2', host: 'BIOMETRIC', account: 'auto' },
      { name: 'w-3', host: 'Biometric', account: null },
      { name: 'jicate-1', host: 'DESKTOP-1LB1FCS', account: 'auto' },
      { name: 'old-worker', host: null, account: 'auto' }
    ]
  };
});

describe('sameHost and findHost', () => {
  it('match a computer name whatever its capital letters, and nothing else', () => {
    expect(sameHost('Biometric', 'biometric')).toBe(true);
    expect(sameHost('Biometric', 'Biometric2')).toBe(false);
    expect(sameHost(null, 'biometric')).toBe(false);
    expect(sameHost(undefined, undefined)).toBe(false);
  });

  it('prefer the exact spelling when both spellings have a row', () => {
    const rows = [{ host: 'biometric' }, { host: 'Biometric' }];
    expect(findHost(rows, 'Biometric')).toBe(rows[1]);
    expect(findHost(rows, 'BIOMETRIC')).toBe(rows[0]);
    expect(findHost(rows, 'other')).toBeUndefined();
  });
});

describe('switching a box (PATCH /api/internal/ai-engine/boxes)', () => {
  it('a box saved as "Biometric" with workers reporting "biometric" all follow one switch', async () => {
    const res = await patch({ host: 'Biometric', account: 'aiece' });
    expect(res.status).toBe(200);
    // Before: only w-3, the one worker with the exact spelling, was moved.
    expect(['w-1', 'w-2', 'w-3'].map((n) => runner(n).account)).toEqual(['aiece', 'aiece', 'aiece']);
    expect(runner('jicate-1').account).toBe('auto');
    expect(runner('old-worker').account).toBe('auto');
  });

  it('changes no stored spelling', async () => {
    await patch({ host: 'Biometric', account: 'aiece' });
    expect(db.tables.ai_runners.map((r) => r.host)).toEqual(['biometric', 'BIOMETRIC', 'Biometric', 'DESKTOP-1LB1FCS', null]);
    expect(db.tables.ai_boxes.map((r) => r.host)).toEqual(['Biometric', 'DESKTOP-1LB1FCS']);
  });

  it('a switch sent in other capitals lands on the saved box row, never a second row for the same computer', async () => {
    const res = await patch({ host: 'biometric', account: 'default' });
    expect((await res.json()).box).toEqual({ host: 'Biometric', account: 'default' });
    expect(db.tables.ai_boxes).toHaveLength(2);
    expect(db.tables.ai_boxes[0]).toMatchObject({ host: 'Biometric', account: 'default', chosen_label: null });
    // "default" is a box's own sign-in: workers store it as no account.
    expect(['w-1', 'w-2', 'w-3'].map((n) => runner(n).account)).toEqual([null, null, null]);
  });

  it('still makes a row for a computer that has none, under the name sent', async () => {
    db.tables.ai_runners.push({ name: 'lab-1', host: 'lab-pc-7', account: null });
    const res = await patch({ host: 'LAB-PC-7', account: 'aiahs' });
    expect(res.status).toBe(200);
    expect(db.tables.ai_boxes.map((r) => r.host)).toContain('LAB-PC-7');
    expect(runner('lab-1').account).toBe('aiahs');
  });

  it('saves nothing when the boxes or workers cannot be read', async () => {
    db.fail = 'ai_runners';
    const res = await patch({ host: 'Biometric', account: 'aiece' });
    expect(res.status).toBe(500);
    expect(db.tables.ai_boxes[0].account).toBe('aiahs');
  });
});

describe('a worker asking for its box account (resolveBoxAccount)', () => {
  const admin = () => fakeAdmin() as unknown as SupabaseClient;

  it('finds the box saved as "Biometric" when the worker reports "biometric"', async () => {
    // Before: no row matched, so the worker fell back to its own setting and did not follow the box.
    expect(await resolveBoxAccount(admin(), 'biometric')).toBe('aiahs');
    expect(await resolveBoxAccount(admin(), 'BIOMETRIC')).toBe('aiahs');
    expect(await resolveBoxAccount(admin(), 'Biometric')).toBe('aiahs');
  });

  it('records what the choice gives on the saved row, whatever spelling asked', async () => {
    db.tables.ai_boxes[0].chosen_label = 'aimech';
    await resolveBoxAccount(admin(), 'biometric');
    expect(db.tables.ai_boxes[0]).toMatchObject({ host: 'Biometric', chosen_label: 'aiahs' });
    expect(db.tables.ai_boxes).toHaveLength(2);
  });

  it('still says "no box choice" for a computer with no row, or with no name', async () => {
    expect(await resolveBoxAccount(admin(), 'LAB-PC-7')).toBeUndefined();
    expect(await resolveBoxAccount(admin(), null)).toBeUndefined();
  });

  it('gives the same answer on every poll when two rows differ only in capitals and neither is the spelling asked', async () => {
    // Read in name order, so which row comes back first never changes the answer.
    db.tables.ai_boxes = [
      { host: 'biometric', account: 'aiece', chosen_label: 'aiece' },
      { host: 'Biometric', account: 'aiahs', chosen_label: 'aiahs' }
    ];
    expect(await resolveBoxAccount(admin(), 'BIOMETRIC')).toBe('aiahs');
    db.tables.ai_boxes.reverse();
    expect(await resolveBoxAccount(admin(), 'BIOMETRIC')).toBe('aiahs');
  });

  it("gives null for a box set to its own sign-in", async () => {
    db.tables.ai_boxes[0].account = 'default';
    expect(await resolveBoxAccount(admin(), 'biometric')).toBeNull();
  });
});
