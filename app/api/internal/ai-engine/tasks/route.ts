/**
 * PATCH /api/internal/ai-engine/tasks — change one JICATE engine recipe's settings.
 *
 * Used by the AI Models page. Super admins only: the engine is platform-wide,
 * so one org's admin must not change what every org's apps get.
 *
 * Body: { job_type, enabled?, model?, interactive?, max_inflight?,
 *         timeout_seconds?, max_answer_words? }
 *
 * The recipe wording (instructions) is deliberately NOT editable here: it is a
 * safety rule set (leak.coach's under-18 rules, for one) and changes go through
 * a reviewed migration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  job_type: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  enabled: z.boolean().optional(),
  model: z.string().regex(/^[a-z0-9.-]{2,40}$/).optional(),
  interactive: z.boolean().optional(),
  max_inflight: z.number().int().min(1).max(20).optional(),
  timeout_seconds: z.number().int().min(10).max(600).optional(),
  max_answer_words: z.number().int().min(10).max(5000).nullable().optional()
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
    return fail('FORBIDDEN', 'Only platform admins can change AI engine settings.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid settings.', 400);
  const { job_type, ...changes } = parsed.data;
  if (Object.keys(changes).length === 0) return fail('BAD_REQUEST', 'Nothing to change.', 400);

  const { data, error } = await admin
    .from('ai_tasks')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('job_type', job_type)
    .select('job_type, enabled, model, interactive, max_inflight, timeout_seconds, max_answer_words')
    .maybeSingle();

  if (error) return fail('UPDATE_FAILED', 'Could not save the change.', 500);
  if (!data) return fail('NOT_FOUND', 'No such task.', 404);
  return NextResponse.json({ task: data });
}
