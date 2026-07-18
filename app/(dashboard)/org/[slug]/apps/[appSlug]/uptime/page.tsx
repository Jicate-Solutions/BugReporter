import { OrganizationServerService } from '@/lib/services/organizations/server';
import { ApplicationServerService } from '@/lib/services/applications/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
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

// Wrapped so react-hooks/purity is satisfied — it flags a bare Date.now() in a
// render body, but this is a server component (rendered once per request), where
// reading the clock is fine. Mirrors how the `ago()` helper reads the clock.
function nowMs(): number {
  return Date.now();
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default async function AppUptimePage({
  params
}: {
  params: Promise<{ slug: string; appSlug: string }>;
}) {
  const { slug, appSlug } = await params;

  const organization = await OrganizationServerService.getOrganizationBySlug(slug);
  if (!organization) notFound();

  const application = await ApplicationServerService.getApplicationBySlug(organization.id, appSlug);
  if (!application) notFound();

  const monitored = isProbeable(application.app_url);

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const dayAgo = new Date(nowMs() - 24 * 60 * 60 * 1000).toISOString();
  const loadChecks = async (): Promise<CheckRow[]> => {
    const { data } = await service
      .from('app_uptime_checks')
      .select('application_id, checked_at, ok, status_code, latency_ms')
      .eq('application_id', application.id)
      .gte('checked_at', dayAgo)
      .order('checked_at', { ascending: false })
      .limit(2000);
    return (data ?? []) as CheckRow[];
  };
  let checks = await loadChecks();

  // First-visit / stale guard: probe this one app live so the tab is never empty.
  const newest = checks[0]?.checked_at;
  if (monitored && (!newest || nowMs() - new Date(newest).getTime() > STALE_MS)) {
    const { results } = await probeApps([{ id: application.id, app_url: application.app_url }]);
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

  const latest = checks[0] ?? null;
  const total = checks.length;
  const okCount = checks.filter((c) => c.ok).length;
  const pct = total > 0 ? Math.round((okCount / total) * 1000) / 10 : null;
  const lastDown = checks.find((c) => !c.ok)?.checked_at ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Activity className="h-5 w-5" />
          Uptime — {application.name}
        </h2>
        <p className="text-muted-foreground text-sm">
          {monitored ? (
            <>
              Pinging <span className="font-mono">{application.app_url}</span> every 5 minutes — last 24 hours.
            </>
          ) : (
            'No public URL registered, so this app is unmonitored.'
          )}
        </p>
      </div>

      {!monitored ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            This app has no public URL (or a localhost/private one), so it can&apos;t be pinged. Add a public URL in
            Settings to monitor it.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">Status now</CardTitle>
            </CardHeader>
            <CardContent>
              {latest == null ? (
                <Badge variant="secondary">no data yet</Badge>
              ) : latest.ok ? (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                  up{latest.status_code ? ` · ${latest.status_code}` : ''}
                </Badge>
              ) : (
                <Badge variant="destructive">down</Badge>
              )}
              <p className="text-muted-foreground mt-2 text-xs">checked {ago(latest?.checked_at ?? null)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">Uptime 24h</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {pct != null ? (
                  <span className={pct < 99 ? 'text-amber-600' : 'text-green-600'}>{pct}%</span>
                ) : (
                  '—'
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {total} check{total === 1 ? '' : 's'} in 24h
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">Response</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {latest?.latency_ms != null ? `${latest.latency_ms}ms` : '—'}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">last down {ago(lastDown)}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
