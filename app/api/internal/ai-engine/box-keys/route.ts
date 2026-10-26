/**
 * /api/internal/ai-engine/box-keys — box keys, platform admins only.
 *
 *   POST { target, value }   set or replace the key for one allow-listed target
 *                            (lib/ai-engine/box-keys.ts). The value is sealed and
 *                            never returned or logged. Saving clears the last
 *                            delivery, so the box agent writes it again.
 *
 * The target is chosen by id only; host, file and variable come from the
 * allow-list in code, never from the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';
import { boxKeyValueOk, findBoxKeyTarget, sealBoxKey } from '@/lib/ai-engine/box-keys';

export const dynamic = 'force-dynamic';

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

const bodySchema = z.object({
  target: z.string().max(64),
  value: z.string().max(1000)
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fail('UNAUTHENTICATED', 'Sign in first.', 401);
  const admin = createAdminClient();
  if (!(await isSuperAdmin(admin, user.id))) {
    return fail('FORBIDDEN', 'Only platform admins can manage box keys.', 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Pick a key and paste its value.', 400);
  const target = findBoxKeyTarget(parsed.data.target);
  if (!target) return fail('BAD_REQUEST', 'That key is not on the allowed list.', 400);
  const value = parsed.data.value.trim();
  if (!boxKeyValueOk(value)) {
    return fail(
      'BAD_REQUEST',
      'The value must be 8 to 1000 characters with no spaces, quotes, backslash, #, $ or backtick.',
      400
    );
  }

  let sealed: string;
  try {
    sealed = sealBoxKey(value);
  } catch {
    return fail('NOT_CONFIGURED', 'The Control Tower is missing its key-encryption setting.', 503);
  }

  const setAt = new Date().toISOString();
  const { error } = await admin.from('ai_box_keys').upsert(
    {
      host: target.host,
      target_id: target.id,
      ciphertext: sealed,
      set_at: setAt,
      set_by: user.id,
      fetched_at: null,
      delivered_at: null,
      delivery_error: null
    },
    { onConflict: 'host,target_id' }
  );
  if (error) return fail('SAVE_FAILED', 'Could not save the key.', 500);
  return NextResponse.json(
    { key: { target: target.id, host: target.host, name: target.name, set_at: setAt, delivered_at: null } },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  );
}
