/**
 * PATCH /api/internal/ai-engine/boxes — choose a whole Windows box's Claude account.
 *
 * Platform admins only. Body: { host, account: label | 'auto' | 'default' | null }.
 * Sets the box choice (the box agent applies it to everything on the box: its
 * own sign-in, MyJKKN's workers, the Claude tabs) and points every JICATE
 * worker on that host at the same choice. null = clear the box choice.
 *
 * The computer name is matched without regard to capital letters: a box saved
 * as "Biometric" and workers that report "biometric" all follow one switch.
 * Each row keeps the spelling it was stored with.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/ai-engine/admin';
import { findHost, sameHost } from '@/lib/ai-engine/accounts';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  host: z.string().min(1).max(100),
  account: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/).nullable()
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
    return fail('FORBIDDEN', 'Only platform admins can switch box accounts.', 403);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Invalid settings.', 400);
  const { host, account } = parsed.data;

  if (account && account !== 'auto' && account !== 'default') {
    const { data: sec } = await admin.from('ai_account_secrets').select('label').eq('label', account).maybeSingle();
    if (!sec) return fail('NO_KEY', `No key stored for "${account}". Add it first.`, 409);
  }

  // Both lists are short (two boxes, a handful of workers), so the name is matched here.
  const [boxesRes, runnersRes] = await Promise.all([
    admin.from('ai_boxes').select('host').order('host').limit(50),
    admin.from('ai_runners').select('name, host')
  ]);
  if (boxesRes.error || runnersRes.error) return fail('SAVE_FAILED', 'Could not save the change.', 500);
  // The spelling the box is already saved under, so no second row appears for the same computer.
  const boxHost = findHost((boxesRes.data ?? []) as { host: string }[], host)?.host ?? host;
  const workers = ((runnersRes.data ?? []) as { name: string; host: string | null }[])
    .filter((r) => sameHost(r.host, host))
    .map((r) => r.name);

  const now = new Date().toISOString();
  const { error } = await admin
    .from('ai_boxes')
    .upsert({ host: boxHost, account, chosen_label: null, updated_at: now }, { onConflict: 'host' });
  if (error) return fail('SAVE_FAILED', 'Could not save the change.', 500);
  if (workers.length) {
    await admin
      .from('ai_runners')
      .update({ account: account === 'default' ? null : account })
      .in('name', workers);
  }
  return NextResponse.json({ box: { host: boxHost, account } });
}
