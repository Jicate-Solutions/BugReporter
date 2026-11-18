/**
 * PATCH /api/internal/ai-engine/pay-vs-use — the "what we pay vs what we use"
 * page's settings. Platform admins only.
 *
 * Body: { idle_below_pct: 1-100 }  an account whose average weekly use is
 * under this line is flagged idle. Stored in ai_engine_watch under the key
 * "pay_vs_use" (that table already exists, so no migration is needed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';
import { SETTINGS_KEY } from '@/lib/ai-engine/pay-vs-use';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ idle_below_pct: z.number().int().min(1).max(100) });

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
    return fail('FORBIDDEN', 'Only platform admins can change this setting.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Use a whole number from 1 to 100.', 400);

  const { error } = await admin.from('ai_engine_watch').upsert(
    {
      key: SETTINGS_KEY,
      value: { idle_below_pct: parsed.data.idle_below_pct, updated_by: user.id },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'key' }
  );
  if (error) return fail('SAVE_FAILED', 'Could not save the setting.', 500);
  return NextResponse.json({ idle_below_pct: parsed.data.idle_below_pct });
}
