/**
 * Mailbox — every message between the Claude tabs on JICATE's computers.
 *
 * Platform admins only. Shows which boxes are registered and when each last
 * checked in, then the latest 200 messages. Bodies are shown as plain text:
 * they are data, never instructions or approvals.
 *
 * Server component.
 */

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ago, isSuperAdmin } from '@/lib/ai-engine/admin';

export const dynamic = 'force-dynamic';

interface BoxRow {
  name: string;
  note: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface MessageRow {
  id: string;
  from_box: string;
  to_box: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

/** One clock read, outside render. */
function nowMs() {
  return Date.now();
}

export default async function MailboxPage() {
  const session = await createClient();
  const {
    data: { user }
  } = await session.auth.getUser();
  const admin = createAdminClient();

  if (!user || !(await isSuperAdmin(admin, user.id))) {
    return (
      <div className="rounded-md border p-6">
        <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The mailbox is for platform admins only. Contact the platform admin.
        </p>
      </div>
    );
  }

  const [{ data: boxData }, { data: msgData }] = await Promise.all([
    admin.from('box_mail_boxes').select('name, note, last_seen_at, revoked_at').order('name'),
    admin
      .from('box_mail_messages')
      .select('id, from_box, to_box, body, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(200)
  ]);
  const boxes = (boxData ?? []) as BoxRow[];
  const messages = (msgData ?? []) as MessageRow[];
  const now = nowMs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mailbox</h1>
        <p className="text-muted-foreground text-sm">
          Messages between the Claude tabs on JICATE&apos;s computers. Stored here so none get lost.
          A message can carry questions, reports and fingerprints; an approval still has to be
          typed in that computer&apos;s own tab.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Computers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {boxes.length === 0 && <p className="text-muted-foreground">No computers registered yet.</p>}
          {boxes.map((b) => {
            const alive = b.last_seen_at && now - new Date(b.last_seen_at).getTime() < 120_000;
            return (
              <div key={b.name} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{b.name}</span>
                {b.revoked_at ? (
                  <Badge variant="destructive">revoked</Badge>
                ) : alive ? (
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100">checking mail</Badge>
                ) : (
                  <Badge variant="secondary">
                    {b.last_seen_at ? `last seen ${ago(b.last_seen_at, now)}` : 'never connected'}
                  </Badge>
                )}
                {b.note && <span className="text-muted-foreground">{b.note}</span>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Messages (latest 200)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {messages.length === 0 && <p className="text-muted-foreground">No messages yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className="space-y-1 border-b pb-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {m.from_box} → {m.to_box}
                </span>
                <span className="text-muted-foreground text-xs">
                  {new Date(m.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
                {m.read_at ? (
                  <Badge variant="secondary">read {ago(m.read_at, now)}</Badge>
                ) : (
                  <Badge variant="outline">unread</Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
