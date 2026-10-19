/**
 * POST /api/internal/mailbox/read { ids: [uuid, ...] } — mark my messages read.
 * Only messages addressed to the caller's box are touched. → 200 { marked }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkBoxAuth } from '@/lib/mailbox/box-auth';

export const dynamic = 'force-dynamic';

const schema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkBoxAuth(request, admin);
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Send { ids: [...] } with 1-100 message ids.' } },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('box_mail_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('to_box', auth.box)
    .is('read_at', null)
    .in('id', parsed.data.ids)
    .select('id');
  if (error) {
    return NextResponse.json(
      { error: { code: 'UPDATE_FAILED', message: 'Could not mark the messages read.' } },
      { status: 500 }
    );
  }
  return NextResponse.json({ marked: (data ?? []).length });
}
