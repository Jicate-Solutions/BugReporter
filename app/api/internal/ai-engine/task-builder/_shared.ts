/**
 * Shared skeleton for the AI task builder routes: who is calling, as an Actor
 * read with the service client, and the error envelope the pages already use.
 * Permission rules live in lib/ai-engine/task-builder.ts; each route calls them.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadActor, type Actor, type Outcome } from '@/lib/ai-engine/task-builder';

export function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function caller(): Promise<
  { ok: true; admin: SupabaseClient; actor: Actor } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: fail('UNAUTHENTICATED', 'Sign in first.', 401) };
  const admin = createAdminClient();
  return { ok: true, admin, actor: await loadActor(admin, user.id) };
}

export function respond<T>(out: Outcome<T>, okStatus = 200) {
  if (!out.ok) return fail(out.code, out.message, out.status);
  return NextResponse.json(out.data, { status: okStatus, headers: { 'Cache-Control': 'no-store' } });
}
