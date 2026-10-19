/**
 * /api/internal/ai-engine/accounts — Claude accounts, platform admins only.
 *
 *   POST   { label, key, priority? }  add an account, or replace its key. The key
 *                                     (from `claude setup-token`) is stored
 *                                     encrypted; it is never returned or logged.
 *   DELETE ?label=acct1               remove the stored key (workers stop using it)
 *   PATCH  { label, priority }        set its priority (below)
 *
 * PATCH — set a Claude account's priority.
 *
 * Platform admins only. Body: { label, priority: 1-99 | null }. In "auto",
 * workers use the highest-priority account (1 first) that still has allowance,
 * move down the list as accounts run out, and come back when one renews.
 * null = after every numbered account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';
import { sealAccountKey } from '@/lib/ai-engine/account-keys';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  priority: z.number().int().min(1).max(99).nullable()
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: fail('UNAUTHENTICATED', 'Sign in first.', 401) };
  const admin = createAdminClient();
  if (!(await isSuperAdmin(admin, user.id))) {
    return { error: fail('FORBIDDEN', 'Only platform admins can manage Claude accounts.', 403) };
  }
  return { admin, user };
}

const addSchema = z.object({
  label: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,30}$/)
    .refine((l) => l !== 'default' && l !== 'auto', 'reserved'),
  key: z.string().trim().min(20).max(500),
  priority: z.number().int().min(1).max(99).nullable().optional()
});

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const { admin, user } = gate;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('BAD_REQUEST', 'Give a short name (a-z, 0-9, -; not "default" or "auto") and the full key.', 400);
  }
  const { label, key, priority } = parsed.data;

  let sealed: string;
  try {
    sealed = sealAccountKey(key);
  } catch {
    return fail('NOT_CONFIGURED', 'The Control Tower is missing its key-encryption setting.', 503);
  }

  const { error: e1 } = await admin
    .from('ai_accounts')
    .upsert({ label, ...(priority === undefined ? {} : { priority }) }, { onConflict: 'label' });
  if (e1) return fail('SAVE_FAILED', 'Could not save the account.', 500);
  const { error: e2 } = await admin
    .from('ai_account_secrets')
    .upsert({ label, ciphertext: sealed, added_at: new Date().toISOString(), added_by: user.id });
  if (e2) return fail('SAVE_FAILED', 'Could not save the key.', 500);
  return NextResponse.json({ account: { label, priority: priority ?? null, key_stored: true } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const label = new URL(request.url).searchParams.get('label') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(label)) return fail('BAD_REQUEST', 'Bad label.', 400);
  const { error } = await gate.admin.from('ai_account_secrets').delete().eq('label', label);
  if (error) return fail('DELETE_FAILED', 'Could not remove the key.', 500);
  return NextResponse.json({ removed: label });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fail('UNAUTHENTICATED', 'Sign in first.', 401);

  const admin = createAdminClient();
  if (!(await isSuperAdmin(admin, user.id))) {
    return fail('FORBIDDEN', 'Only platform admins can change account priorities.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Priority must be a whole number from 1 to 99.', 400);

  const { data, error } = await admin
    .from('ai_accounts')
    .update({ priority: parsed.data.priority })
    .eq('label', parsed.data.label)
    .select('label, priority')
    .maybeSingle();
  if (error) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
  if (!data) return fail('NOT_FOUND', 'No account with that label yet.', 404);
  return NextResponse.json({ account: data });
}
