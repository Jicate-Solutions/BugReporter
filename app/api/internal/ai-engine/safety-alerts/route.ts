/**
 * PATCH /api/internal/ai-engine/safety-alerts — mark one safety alert followed up.
 *
 * Platform admins only (Director decision 2026-10-19: alerts land with him
 * first). Body: { id }. Marking is one-way; the row is kept as a record.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ id: z.uuid() });

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
    return fail('FORBIDDEN', 'Only platform admins can handle safety alerts.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid alert id.', 400);

  const { data, error } = await admin
    .from('ai_safety_alerts')
    .update({ followed_up_at: new Date().toISOString(), followed_up_by: user.id })
    .eq('id', parsed.data.id)
    .is('followed_up_at', null)
    .select('id, followed_up_at')
    .maybeSingle();

  if (error) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
  if (!data) return fail('NOT_FOUND', 'No open alert with that id.', 404);
  return NextResponse.json({ alert: data });
}
