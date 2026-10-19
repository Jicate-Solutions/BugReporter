/**
 * PATCH /api/internal/ai-engine/runners — choose a worker's Claude account.
 *
 * Platform admins only. Body: { name, account: label | 'auto' | null, account_fallback? }
 * account null = the box's own sign-in; 'auto' = the Tower picks the account with
 * the most allowance left at each claim. A label must be one the worker itself
 * reported holding, so a typo can't point a worker at an account it lacks.
 * Takes effect from the worker's next claim.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  account: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/).nullable(),
  account_fallback: z.boolean().optional()
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fail('UNAUTHENTICATED', 'Sign in first.', 401);

  const admin = createAdminClient();
  if (!(await isSuperAdmin(admin, user.id))) {
    return fail('FORBIDDEN', 'Only platform admins can change worker accounts.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid settings.', 400);
  const { name, account, account_fallback } = parsed.data;

  const { data: row } = await admin
    .from('ai_runners')
    .select('accounts_available')
    .eq('name', name)
    .maybeSingle();
  if (!row) return fail('NOT_FOUND', 'No such worker.', 404);
  const available = (row as { accounts_available: string[] | null }).accounts_available ?? [];
  if (account && account !== 'default' && account !== 'auto' && !available.includes(account)) {
    return fail(
      'ACCOUNT_NOT_ON_BOX',
      `${name} has no account called "${account}". Add it on the Windows box first.`,
      409
    );
  }

  const { data, error } = await admin
    .from('ai_runners')
    .update({
      account: account === 'default' ? null : account,
      ...(account_fallback === undefined ? {} : { account_fallback })
    })
    .eq('name', name)
    .select('name, account, account_fallback')
    .maybeSingle();
  if (error || !data) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
  return NextResponse.json({ runner: data });
}
