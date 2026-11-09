/**
 * Box keys — secrets a Windows box needs in one of its env files, pasted here
 * once instead of typed on the box (Director, 2026-10-26).
 *
 * Platform admins only. Platform-wide: the boxes serve every org. Only the
 * targets in lib/ai-engine/box-keys.ts are offered. A saved value is never
 * shown again: only when it was set, when the box agent fetched it and whether
 * it was delivered.
 *
 * Server component.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ago, isSuperAdmin } from '@/lib/ai-engine/admin';
import { BOX_KEY_TARGETS } from '@/lib/ai-engine/box-keys';
import { BoxKeyForm } from './_components/box-key-form';

export const dynamic = 'force-dynamic';

interface BoxKeyRow {
  host: string;
  target_id: string;
  set_at: string;
  fetched_at: string | null;
  delivered_at: string | null;
  delivery_error: string | null;
}

/** One clock read, outside render. */
function nowMs() {
  return Date.now();
}

const when = (iso: string, now: number) =>
  `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (${ago(iso, now)})`;

export default async function BoxKeysPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
          Box keys are for platform admins only. Contact the platform admin.
        </p>
      </div>
    );
  }

  const [keysRes, boxesRes] = await Promise.all([
    admin.from('ai_box_keys').select('host, target_id, set_at, fetched_at, delivered_at, delivery_error'),
    admin.from('ai_boxes').select('host, agent_seen_at')
  ]);
  const notReady = Boolean(keysRes.error);
  const rows = new Map(
    ((keysRes.data ?? []) as BoxKeyRow[]).map((r) => [`${r.host.toLowerCase()}|${r.target_id}`, r])
  );
  const seen = new Map(
    ((boxesRes.data ?? []) as { host: string; agent_seen_at: string | null }[]).map((b) => [
      b.host.toLowerCase(),
      b.agent_seen_at
    ])
  );
  const now = nowMs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Box keys</h1>
        <p className="text-muted-foreground text-sm">
          Paste a key once here and the account agent on that Windows box writes it into the right
          file, usually within a minute or two. The key is stored encrypted and never shown again.
          Only the keys listed below can be set. Back to{' '}
          <Link href={`/org/${slug}/ai/routines`} className="underline">
            AI Routines
          </Link>
          .
        </p>
      </div>

      {notReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Box keys are not switched on yet: the database change for them has not been applied.
          Saving will not work until it is.
        </div>
      )}

      {BOX_KEY_TARGETS.map((t) => {
        const row = rows.get(`${t.host.toLowerCase()}|${t.id}`);
        const agentSeen = seen.get(t.host.toLowerCase()) ?? null;
        const agentAlive = agentSeen && now - new Date(agentSeen).getTime() < 180_000;
        return (
          <Card key={t.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span className="font-mono">{t.name}</span>
                {!row ? (
                  <Badge variant="secondary">not set</Badge>
                ) : row.delivered_at ? (
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100">delivered</Badge>
                ) : row.delivery_error ? (
                  <Badge variant="destructive">not delivered</Badge>
                ) : (
                  <Badge variant="secondary">waiting for the box</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{t.description}</p>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted-foreground">Box</dt>
                <dd>
                  {t.host}{' '}
                  <span className="text-muted-foreground">
                    · agent {agentSeen ? `seen ${ago(agentSeen, now)}` : 'never seen'}
                    {agentSeen && !agentAlive ? ' (not checking in now)' : ''}
                  </span>
                </dd>
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-mono break-all">{t.file}</dd>
                <dt className="text-muted-foreground">Set</dt>
                <dd>{row ? when(row.set_at, now) : 'never'}</dd>
                <dt className="text-muted-foreground">Fetched by the box</dt>
                <dd>{row?.fetched_at ? when(row.fetched_at, now) : 'not yet'}</dd>
                <dt className="text-muted-foreground">Delivered</dt>
                <dd>
                  {row?.delivered_at ? (
                    when(row.delivered_at, now)
                  ) : row?.delivery_error ? (
                    <span className="text-red-600">
                      failed: {row.delivery_error}. Fix the cause on the box, then save the key again.
                    </span>
                  ) : row ? (
                    'not yet'
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
              <BoxKeyForm target={t.id} name={t.name} isSet={Boolean(row)} />
            </CardContent>
          </Card>
        );
      })}

      <p className="text-muted-foreground text-xs">
        The box agent keeps a copy of the file it changed next to it (name ending in .bak- and the
        time), with the old value. Every handout to a box is listed under Key handouts on AI
        Routines.
      </p>
    </div>
  );
}
