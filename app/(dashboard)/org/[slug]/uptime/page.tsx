/**
 * Uptime board (Phase 2 of the Control Tower).
 *
 * One screen: is every Jicate app up right now, how fast is it answering, and
 * what did the last 24 hours look like. Data = app_uptime_checks (fed by the
 * 5-minute cron). If the newest check is stale (>10 min — e.g. first visit
 * before the cron has run), the page probes live and records the results, so
 * the board is never empty.
 *
 * "Up" = the server answered (any HTTP status). "Down" = no response at all.
 * Apps registered with localhost/private URLs are "unmonitored", not "down".
 */

import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { isProbeable, probeApps } from '@/lib/uptime/probe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALE_MS = 10 * 60 * 1000;

interface CheckRow {
  application_id: string;
  checked_at: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
}

interface AppRow {
  id: string;
  name: string;
  slug: string;
  app_url: string | null;
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default async function UptimePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Explicit access re-check (session-scoped; RLS decides membership).
  const session = await createClient();
  const { data: org } = await session
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single();
  if (!org) {
    return (
      <div className="rounded-md border p-6">
        <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your account isn&apos;t a member of this organization. Contact the platform admin.
        </p>
      </div>
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: appsData } = await service
    .from('applications')
    .select('id, name, slug, app_url')
    .eq('organization_id', org.id)
    .order('name');
  const apps = (appsData ?? []) as AppRow[];

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const loadChecks = async (): Promise<CheckRow[]> => {
    const { data } = await service
      .from('app_uptime_checks')
      .select('application_id, checked_at, ok, status_code, latency_ms')
      .gte('checked_at', dayAgo)
      .order('checked_at', { ascending: false })
      .limit(12000);
    return (data ?? []) as CheckRow[];
  };

  let checks = await loadChecks();

  // First-visit / stale guard: probe live so the board is never empty.
  const newest = checks[0]?.checked_at;
  if (!newest || Date.now() - new Date(newest).getTime() > STALE_MS) {
    const { results } = await probeApps(apps);
    if (results.length > 0) {
      await service.from('app_uptime_checks').insert(
        results.map((r) => ({
          application_id: r.application_id,
          ok: r.ok,
          status_code: r.status_code,
          latency_ms: r.latency_ms,
          error: r.error
        }))
      );
      checks = await loadChecks();
    }
  }

  // Aggregate per app.
  const byApp = new Map<
    string,
    { latest: CheckRow | null; total: number; okCount: number; lastDown: string | null }
  >();
  for (const c of checks) {
    let e = byApp.get(c.application_id);
    if (!e) {
      e = { latest: null, total: 0, okCount: 0, lastDown: null };
      byApp.set(c.application_id, e);
    }
    if (!e.latest) e.latest = c; // rows arrive newest-first
    e.total += 1;
    if (c.ok) e.okCount += 1;
    else if (!e.lastDown) e.lastDown = c.checked_at;
  }

  const monitored = apps.filter((a) => isProbeable(a.app_url));
  const unmonitored = apps.filter((a) => !isProbeable(a.app_url));
  const upNow = monitored.filter((a) => byApp.get(a.id)?.latest?.ok === true).length;
  const downNow = monitored.filter((a) => byApp.get(a.id)?.latest?.ok === false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Uptime</h1>
        <p className="text-muted-foreground text-sm">
          Every app&apos;s public URL, pinged every 5 minutes — last 24 hours.
          &quot;Up&quot; means the server answered; apps without a public URL are
          unmonitored, not down.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Up now</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${downNow.length === 0 ? 'text-green-600' : ''}`}>
              {upNow}
              <span className="text-muted-foreground text-xl"> / {monitored.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Down now</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${downNow.length > 0 ? 'text-red-600' : ''}`}>
              {downNow.length}
            </div>
            {downNow.length > 0 && (
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {downNow.map((a) => a.name).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Unmonitored
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{unmonitored.length}</div>
            <p className="text-muted-foreground mt-1 text-xs">no public URL registered</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monitored apps</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Response</TableHead>
                <TableHead className="text-right">Uptime 24h</TableHead>
                <TableHead className="text-right">Last down</TableHead>
                <TableHead className="text-right">Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitored.map((app) => {
                const agg = byApp.get(app.id);
                const latest = agg?.latest ?? null;
                const pct =
                  agg && agg.total > 0 ? Math.round((agg.okCount / agg.total) * 1000) / 10 : null;
                return (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div className="font-medium">{app.name}</div>
                      <div className="text-muted-foreground max-w-[280px] truncate text-xs">
                        {app.app_url}
                      </div>
                    </TableCell>
                    <TableCell>
                      {latest == null ? (
                        <Badge variant="secondary">no data</Badge>
                      ) : latest.ok ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          up{latest.status_code ? ` · ${latest.status_code}` : ''}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">down</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {latest?.latency_ms != null ? `${latest.latency_ms}ms` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct != null ? (
                        <span className={pct < 99 ? 'text-amber-600' : ''}>{pct}%</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">
                      {ago(agg?.lastDown ?? null)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">
                      {ago(latest?.checked_at ?? null)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {monitored.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    No apps with public URLs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {unmonitored.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unmonitored</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-3 text-sm">
              These apps are registered with localhost or invalid URLs. Set a real
              public URL on the app&apos;s edit page to start monitoring.
            </p>
            <div className="flex flex-wrap gap-2">
              {unmonitored.map((a) => (
                <Badge key={a.id} variant="outline">
                  {a.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
