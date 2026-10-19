/**
 * PATCH /api/internal/ai-engine/accounts — set a Claude account's priority.
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

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  priority: z.number().int().min(1).max(99).nullable()
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
