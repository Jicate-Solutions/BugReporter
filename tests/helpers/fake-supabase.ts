/**
 * A small in-memory stand-in for the supabase-js client, enough for the triage
 * lane and the AI Door guards: from().select/insert/update/upsert with
 * eq/neq/gte/lt/in/not-in filters, order/range/limit, single/maybeSingle, and
 * rpc() through registered handlers. Projections are ignored (whole rows come
 * back). Failures are injected per table + operation with failNext().
 *
 * It is a test double, not a Postgres emulator: the SQL itself (claim
 * function, constraints, triggers) is exercised separately against a real
 * Postgres — see the PR description.
 */

import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type Result = { data: any; error: { message: string } | null };

const AUTHOR_KINDS = ['user', 'developer', 'reporter', 'system', 'ai'];

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, (args: any) => any> = {};
  private failures: { table: string; op: Op; message: string }[] = [];
  user: { id: string } | null = null;
  calls: { table: string; op: Op; payload?: unknown }[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  failNext(table: string, op: Op, message = 'injected failure') {
    this.failures.push({ table, op, message });
  }

  takeFailure(table: string, op: Op): string | null {
    const i = this.failures.findIndex((f) => f.table === table && f.op === op);
    if (i === -1) return null;
    const [f] = this.failures.splice(i, 1);
    return f.message;
  }

  client(): any {
    return {
      from: (table: string) => new Query(this, table),
      rpc: async (name: string, args: any): Promise<Result> => {
        const fn = this.rpcs[name];
        if (!fn) return { data: null, error: { message: `no rpc ${name}` } };
        try {
          return { data: await fn(args), error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
      auth: {
        getUser: async () => ({ data: { user: this.user }, error: null })
      }
    };
  }
}

class Query {
  private op: Op = 'select';
  private payload: any = null;
  private filters: ((r: Row) => boolean)[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private returning = false;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(private db: FakeDb, private table: string) {}

  select() {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(payload: any) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  upsert(payload: any, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = payload;
    this.upsertOpts = opts;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  gte(col: string, val: any) {
    this.filters.push((r) => r[col] >= val);
    return this;
  }
  lt(col: string, val: any) {
    this.filters.push((r) => r[col] < val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  not(col: string, operator: string, val: string | null) {
    if (operator === 'is' && val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
      return this;
    }
    if (operator !== 'in' || typeof val !== 'string') throw new Error(`fake: not(${operator}) unsupported`);
    const list = val.replace(/^\(|\)$/g, '').split(',');
    this.filters.push((r) => !list.includes(r[col]));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { col, asc: opts.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.rng = [from, to];
    return this;
  }
  async single(): Promise<Result> {
    const res = await this.run();
    if (res.error) return res;
    const arr = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
    if (arr.length !== 1) return { data: null, error: { message: `expected 1 row, got ${arr.length}` } };
    return { data: arr[0], error: null };
  }
  async maybeSingle(): Promise<Result> {
    const res = await this.run();
    if (res.error) return res;
    const arr = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
    if (arr.length > 1) return { data: null, error: { message: 'more than one row' } };
    return { data: arr[0] ?? null, error: null };
  }
  then<T>(onFulfilled: (r: Result) => T, onRejected?: (e: unknown) => T) {
    return this.run().then(onFulfilled, onRejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private async run(): Promise<Result> {
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload });
    const injected = this.db.takeFailure(this.table, this.op);
    if (injected) return { data: null, error: { message: injected } };

    const now = new Date().toISOString();
    if (this.op === 'select') {
      let rows = this.matching().map((r) => ({ ...r }));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) rows = rows.slice(0, this.lim);
      return { data: rows, error: null };
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const input = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = (this.upsertOpts.onConflict ?? '').split(',').filter(Boolean);
      const out: Row[] = [];
      for (const raw of input) {
        if (this.table === 'bug_report_messages' && !AUTHOR_KINDS.includes(raw.author_kind ?? 'user')) {
          return { data: null, error: { message: 'violates check constraint author_kind' } };
        }
        if (keys.length) {
          const dup = this.db.rows(this.table).find((r) => keys.every((k) => r[k] === raw[k]));
          if (dup) {
            if (this.upsertOpts.ignoreDuplicates) continue;
            Object.assign(dup, raw);
            out.push({ ...dup });
            continue;
          }
        }
        const row = { id: randomUUID(), created_at: now, ...raw };
        if (this.table === 'triage_jobs') {
          row.status ??= 'queued';
          row.attempts ??= 0;
          row.kind ??= 'triage.v1';
        }
        this.db.rows(this.table).push(row);
        out.push({ ...row });
      }
      return { data: this.returning ? out : null, error: null };
    }

    if (this.op === 'update') {
      const rows = this.matching();
      for (const r of rows) Object.assign(r, this.payload);
      return { data: this.returning ? rows.map((r) => ({ ...r })) : null, error: null };
    }

    return { data: null, error: { message: `fake: ${this.op} unsupported` } };
  }
}
