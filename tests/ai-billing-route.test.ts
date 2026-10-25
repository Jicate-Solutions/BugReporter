import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/internal/ai-engine/billing: only an org owner / admin (or super admin)
 * may add a billing client, set a discount or link an app; a developer or an
 * app maintainer may not (applications' own RLS would let a maintainer, so
 * the route is the gate). Before the migration it answers NOT_READY.
 */

const ORG = '0f0f0f0f-0000-4000-8000-000000000001';
const OTHER_ORG = '0f0f0f0f-0000-4000-8000-000000000002';
const APP = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLIENT = 'cccccccc-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  orgRole: 'admin' as string | null,
  superAdmin: false,
  appRole: null as string | null,
  schemaMissing: false,
  clientOrg: null as string | null,
  writes: [] as { table: string; op: string; payload: unknown }[]
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })
}));

vi.mock('@/lib/ai-engine/task-builder', () => ({
  loadActor: async () => ({
    userId: 'user-1',
    superAdmin: state.superAdmin,
    orgRoles: new Map(state.orgRole ? [[ORG, state.orgRole]] : []),
    appRoles: new Map(state.appRole ? [[APP, state.appRole]] : [])
  })
}));

const MISSING = { code: '42P01', message: 'relation does not exist' };

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'applications') return { data: { id: APP, organization_id: ORG }, error: null };
          if (state.schemaMissing) return { data: null, error: MISSING };
          return {
            data: state.clientOrg ? { organization_id: state.clientOrg } : null,
            error: null
          };
        },
        single: async () => ({ data: { myjkkn_client_id: CLIENT, name_cached: 'Acme', discount_pct: '0' }, error: null }),
        upsert: (payload: unknown) => {
          state.writes.push({ table, op: 'upsert', payload });
          return chain;
        },
        update: (payload: unknown) => {
          state.writes.push({ table, op: 'update', payload });
          return {
            eq: () =>
              Object.assign(Promise.resolve({ error: state.schemaMissing ? MISSING : null }), {
                select: () => ({ single: chain.single })
              })
          };
        }
      };
      return chain;
    }
  })
}));

const { POST, PATCH } = await import('@/app/api/internal/ai-engine/billing/route');

function req(method: string, body: unknown) {
  return new NextRequest('https://bugs.example.com/api/internal/ai-engine/billing', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  state.orgRole = 'admin';
  state.superAdmin = false;
  state.appRole = null;
  state.schemaMissing = false;
  state.clientOrg = null;
  state.writes.length = 0;
});

describe('POST (add a client by MyJKKN id)', () => {
  const body = { organization_id: ORG, myjkkn_client_id: CLIENT, name: 'Acme' };

  it('an org admin adds a client; only id, org and cached name are written', async () => {
    const res = await POST(req('POST', body));
    expect(res.status).toBe(201);
    expect(state.writes).toHaveLength(1);
    const p = state.writes[0].payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(['myjkkn_client_id', 'name_cached', 'organization_id', 'updated_at']);
    expect('discount_pct' in p).toBe(false); // new clients start at the 0 default
  });

  it('an org developer or an app maintainer is refused', async () => {
    state.orgRole = 'developer';
    expect((await POST(req('POST', body))).status).toBe(403);
    state.orgRole = null;
    state.appRole = 'maintainer';
    expect((await POST(req('POST', body))).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });

  it('refuses a client already held by another organisation', async () => {
    state.clientOrg = OTHER_ORG;
    expect((await POST(req('POST', body))).status).toBe(409);
  });

  it('rejects an id that is not a uuid', async () => {
    expect((await POST(req('POST', { ...body, myjkkn_client_id: 'acme' }))).status).toBe(400);
  });

  it('says NOT_READY before the migration is applied', async () => {
    state.schemaMissing = true;
    const res = await POST(req('POST', body));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('NOT_READY');
  });
});

describe('PATCH (discount, link)', () => {
  it('an org admin sets a discount', async () => {
    state.clientOrg = ORG;
    const res = await PATCH(req('PATCH', { myjkkn_client_id: CLIENT, discount_pct: 12.5 }));
    expect(res.status).toBe(200);
    expect(state.writes[0].payload).toMatchObject({ discount_pct: 12.5 });
  });

  it('rejects a discount over 100 or with 3 decimals', async () => {
    state.clientOrg = ORG;
    expect((await PATCH(req('PATCH', { myjkkn_client_id: CLIENT, discount_pct: 101 }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { myjkkn_client_id: CLIENT, discount_pct: 1.005 }))).status).toBe(400);
  });

  it('a developer cannot set a discount', async () => {
    state.clientOrg = ORG;
    state.orgRole = 'developer';
    expect((await PATCH(req('PATCH', { myjkkn_client_id: CLIENT, discount_pct: 5 }))).status).toBe(403);
  });

  it('an org admin links and unlinks an app', async () => {
    state.clientOrg = ORG;
    expect((await PATCH(req('PATCH', { application_id: APP, myjkkn_client_id: CLIENT }))).status).toBe(200);
    expect((await PATCH(req('PATCH', { application_id: APP, myjkkn_client_id: null }))).status).toBe(200);
    expect(state.writes.map((w) => w.payload)).toEqual([
      { billing_client_id: CLIENT },
      { billing_client_id: null }
    ]);
  });

  it('an app maintainer cannot link their own app to a client', async () => {
    state.orgRole = null;
    state.appRole = 'maintainer';
    state.clientOrg = ORG;
    expect((await PATCH(req('PATCH', { application_id: APP, myjkkn_client_id: CLIENT }))).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });

  it('will not link an app to another organisation’s client', async () => {
    state.clientOrg = OTHER_ORG;
    expect((await PATCH(req('PATCH', { application_id: APP, myjkkn_client_id: CLIENT }))).status).toBe(404);
  });
});
