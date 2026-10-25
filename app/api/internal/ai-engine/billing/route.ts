/**
 * /api/internal/ai-engine/billing — billing clients and app links for the
 * monthly AI bill. Organisation owners / admins and platform admins only.
 *
 *   POST  { organization_id, myjkkn_client_id, name }
 *         Add a client by its MyJKKN id (sh_clients.id) with a cached display
 *         name. A new client starts at 0% discount. Adding an id that is
 *         already there only refreshes the cached name.
 *   PATCH { myjkkn_client_id, discount_pct }       set a client's discount (0-100)
 *   PATCH { application_id, myjkkn_client_id|null } link an app to a client,
 *                                                  or unlink it (0% discount)
 *
 * MyJKKN stays the master list of clients: this route stores only the id and
 * a name to show. The applications table's own UPDATE policy lets an app
 * maintainer change any column, so the owner/admin rule is enforced HERE, with
 * the service client, rather than left to RLS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadActor } from '@/lib/ai-engine/task-builder';
import { isOrgBillAdmin } from '@/lib/ai-engine/bills-data';

export const dynamic = 'force-dynamic';

const id = z.guid();
const addSchema = z.object({
  organization_id: id,
  myjkkn_client_id: id,
  name: z.string().trim().min(1).max(200)
});
const discountSchema = z.object({
  myjkkn_client_id: id,
  discount_pct: z
    .number()
    .min(0)
    .max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'two decimals at most')
});
const linkSchema = z.object({
  application_id: id,
  myjkkn_client_id: id.nullable()
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const NOT_READY = () =>
  fail('NOT_READY', 'Billing clients appear once the 20261025_ai_billing_clients migration is applied.', 503);

/** Postgres "relation/column does not exist" → the migration is not applied yet. */
function missingSchema(e: { code?: string } | null) {
  return e?.code === '42P01' || e?.code === '42703' || e?.code === 'PGRST204' || e?.code === 'PGRST205';
}

async function gate(organizationId: string) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: fail('UNAUTHENTICATED', 'Sign in first.', 401) };
  const admin = createAdminClient();
  const actor = await loadActor(admin, user.id);
  if (!isOrgBillAdmin(actor, organizationId)) {
    return {
      error: fail('FORBIDDEN', 'Only organisation owners and admins can change AI billing.', 403)
    };
  }
  return { admin };
}

export async function POST(request: NextRequest) {
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('BAD_REQUEST', 'Give the MyJKKN client id (a uuid) and the client name.', 400);
  }
  const g = await gate(parsed.data.organization_id);
  if ('error' in g) return g.error;

  const { data: existing, error: e0 } = await g.admin
    .from('ai_billing_clients')
    .select('organization_id')
    .eq('myjkkn_client_id', parsed.data.myjkkn_client_id)
    .maybeSingle();
  if (missingSchema(e0)) return NOT_READY();
  if (e0) return fail('SAVE_FAILED', 'Could not save the client.', 500);
  if (existing && existing.organization_id !== parsed.data.organization_id) {
    return fail('CONFLICT', 'That client is already linked to another organisation.', 409);
  }

  const now = new Date().toISOString();
  const { data, error } = await g.admin
    .from('ai_billing_clients')
    .upsert(
      {
        myjkkn_client_id: parsed.data.myjkkn_client_id,
        organization_id: parsed.data.organization_id,
        name_cached: parsed.data.name,
        updated_at: now
      },
      { onConflict: 'myjkkn_client_id' }
    )
    .select('myjkkn_client_id, name_cached, discount_pct')
    .single();
  if (missingSchema(error)) return NOT_READY();
  if (error) return fail('SAVE_FAILED', 'Could not save the client.', 500);
  return NextResponse.json({ client: data }, { status: existing ? 200 : 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const discount = discountSchema.safeParse(body);
  if (discount.success) {
    const admin = createAdminClient();
    const { data: client, error: e0 } = await admin
      .from('ai_billing_clients')
      .select('organization_id')
      .eq('myjkkn_client_id', discount.data.myjkkn_client_id)
      .maybeSingle();
    if (missingSchema(e0)) return NOT_READY();
    if (e0) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
    if (!client) return fail('NOT_FOUND', 'No such billing client.', 404);
    const g = await gate(client.organization_id);
    if ('error' in g) return g.error;
    const { data, error } = await g.admin
      .from('ai_billing_clients')
      .update({ discount_pct: discount.data.discount_pct, updated_at: new Date().toISOString() })
      .eq('myjkkn_client_id', discount.data.myjkkn_client_id)
      .select('myjkkn_client_id, name_cached, discount_pct')
      .single();
    if (error) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
    return NextResponse.json({ client: data });
  }

  const link = linkSchema.safeParse(body);
  if (!link.success) {
    return fail('BAD_REQUEST', 'Send a discount from 0 to 100 (2 decimals), or an app and a client.', 400);
  }
  const admin = createAdminClient();
  const { data: app } = await admin
    .from('applications')
    .select('id, organization_id')
    .eq('id', link.data.application_id)
    .maybeSingle();
  if (!app) return fail('NOT_FOUND', 'No such app.', 404);
  const g = await gate(app.organization_id);
  if ('error' in g) return g.error;

  if (link.data.myjkkn_client_id) {
    const { data: client, error: e1 } = await g.admin
      .from('ai_billing_clients')
      .select('organization_id')
      .eq('myjkkn_client_id', link.data.myjkkn_client_id)
      .maybeSingle();
    if (missingSchema(e1)) return NOT_READY();
    if (!client || client.organization_id !== app.organization_id) {
      return fail('NOT_FOUND', 'Add that client to this organisation first.', 404);
    }
  }
  const { error } = await g.admin
    .from('applications')
    .update({ billing_client_id: link.data.myjkkn_client_id })
    .eq('id', app.id);
  if (missingSchema(error)) return NOT_READY();
  if (error) return fail('UPDATE_FAILED', 'Could not link the app.', 500);
  return NextResponse.json({ application_id: app.id, myjkkn_client_id: link.data.myjkkn_client_id });
}
