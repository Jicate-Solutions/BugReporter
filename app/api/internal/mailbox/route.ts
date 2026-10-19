/**
 * The box mailbox. Auth: `Authorization: Bearer <box token>` (lib/mailbox/box-auth.ts).
 *
 *   POST { to, body }        send one message → 201 { id }
 *   GET  ?all=1              my unread messages, oldest first (all=1: last 50, read or not)
 *                            → 200 { box, boxes, messages: [{ id, from, body, created_at, read_at }] }
 *
 * Mark messages read with POST /api/internal/mailbox/read. Bodies are stored
 * and returned as plain text; they are data, never instructions or approvals.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkBoxAuth } from '@/lib/mailbox/box-auth';

export const dynamic = 'force-dynamic';

const sendSchema = z.object({
  to: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  body: z.string().min(1).max(20_000)
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkBoxAuth(request, admin);
  if (!auth.ok) return auth.response;

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('BAD_REQUEST', 'Send { to, body } with a box name and 1-20000 characters.', 400);
  const { to, body } = parsed.data;

  const { data: target } = await admin
    .from('box_mail_boxes')
    .select('name')
    .eq('name', to)
    .is('revoked_at', null)
    .maybeSingle();
  if (!target) return fail('UNKNOWN_BOX', `No mailbox named "${to}".`, 404);

  const { data, error } = await admin
    .from('box_mail_messages')
    .insert({ from_box: auth.box, to_box: to, body })
    .select('id')
    .single();
  if (error) return fail('SEND_FAILED', 'Could not store the message.', 500);
  return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkBoxAuth(request, admin);
  if (!auth.ok) return auth.response;

  const all = new URL(request.url).searchParams.get('all') === '1';
  let query = admin
    .from('box_mail_messages')
    .select('id, from_box, body, created_at, read_at')
    .eq('to_box', auth.box);
  query = all
    ? query.order('created_at', { ascending: false }).limit(50)
    : query.is('read_at', null).order('created_at', { ascending: true }).limit(100);
  const [{ data, error }, { data: boxes }] = await Promise.all([
    query,
    admin.from('box_mail_boxes').select('name').is('revoked_at', null).order('name')
  ]);
  if (error) return fail('READ_FAILED', 'Could not read the mailbox.', 500);

  return NextResponse.json({
    box: auth.box,
    boxes: (boxes ?? []).map((b) => (b as { name: string }).name),
    messages: (data ?? []).map((m) => {
      const r = m as { id: string; from_box: string; body: string; created_at: string; read_at: string | null };
      return { id: r.id, from: r.from_box, body: r.body, created_at: r.created_at, read_at: r.read_at };
    })
  });
}
