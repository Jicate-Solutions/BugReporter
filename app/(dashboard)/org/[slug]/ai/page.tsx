/**
 * AI cockpit (Phase 1.5 of the Jicate AI door / Control Tower).
 *
 * One screen answering: which apps have AI on, what may they run, how much have
 * they used it, and what did it cost (always ₹0 — the Max lane has no paid path).
 *
 * Data sources:
 *  - LOCAL:  applications.settings.ai (the per-app switch + task menu)
 *  - ENGINE: MyJKKN GET /api/b2a/ai/stats (per-app job aggregates) and
 *    GET /api/b2a/ai/job-types?external_only=1 (the real task catalogue), both
 *    fetched server-side with the platform's single MYJKKN_AI_KEY. If the
 *    engine is unreachable the page still renders local state with a banner.
 *
 * The catalogue is read live rather than from a local constant: this platform
 * used to hardcode the task list and it drifted out of date, hiding tasks
 * MyJKKN allowed. See lib/ai/tasks.ts.
 *
 * Server component. Membership is enforced by the org layout (session-scoped
 * getOrganizationBySlug → notFound) and re-checked here explicitly.
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
import { FALLBACK_AI_TASKS, fetchAiJobTypeCatalogue } from '@/lib/ai/tasks';

export const dynamic = 'force-dynamic';

interface EngineAppStat {
  app_id: string;
  jobs: number;
  done: number;
  error: number;
  in_flight: number;
  avg_turnaround_secs: number | null;
  last_run: string | null;
}

interface EngineStats {
  days: number;
  totals: {
    jobs: number;
    done: number;
    error: number;
    in_flight: number;
    cost_inr: number;
    truncated: boolean;
  };
  apps: EngineAppStat[];
  recent: Array<{
    job_id: string;
    app_id: string;
    task: string;
    status: string;
    requested_at: string;
    turnaround_secs: number | null;
  }>;
}

interface AppRow {
  id: string;
  name: string;
  slug: string;
  settings: { ai?: { enabled?: boolean; allowed_tasks?: string[] } } | null;
}

async function fetchEngineStats(): Promise<EngineStats | null> {
  const base = process.env.MYJKKN_AI_URL;
  const key = process.env.MYJKKN_AI_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/b2a/ai/stats?days=7`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return (await res.json()) as EngineStats;
  } catch {
    return null;
  }
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function statusBadge(status: string) {
  if (status === 'done')
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">done</Badge>;
  if (status === 'error' || status === 'canceled')
    return <Badge variant="destructive">error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default async function AiCockpitPage({
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

  // Local truth: every app + its AI switch (service client; page is org-gated above).
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: appsData } = await service
    .from('applications')
    .select('id, name, slug, settings')
    .eq('organization_id', org.id)
    .order('name');
  const apps = (appsData ?? []) as AppRow[];

  // Engine truth: per-app usage + the real task catalogue (tolerate unreachable).
  // Independent reads, so fetch them together rather than one after the other.
  const [stats, catalogue] = await Promise.all([
    fetchEngineStats(),
    fetchAiJobTypeCatalogue()
  ]);
  const statsByApp = new Map((stats?.apps ?? []).map((a) => [a.app_id, a]));

  const enabledCount = apps.filter((a) => a.settings?.ai?.enabled === true).length;
  // Label the per-app "Approved tasks" column from the live catalogue, falling
  // back to the offline snapshot so keys still read as names when it's down.
  const taskLabel = new Map<string, string>(
    catalogue
      ? catalogue.map((t) => [t.job_type, t.title ?? t.job_type])
      : FALLBACK_AI_TASKS.map((t) => [t.key, t.label])
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI</h1>
        <p className="text-muted-foreground text-sm">
          Every app&apos;s AI usage on the ₹0 Max lane — last {stats?.days ?? 7} days. Jobs
          queue behind MyJKKN&apos;s own work; there is no paid fallback.
        </p>
      </div>

      {(!stats || !catalogue) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {!stats && !catalogue
            ? "Couldn't reach the AI engine just now — showing each app's local AI settings and the built-in task list. Refresh in a minute."
            : !stats
              ? "Couldn't reach the AI engine for usage numbers just now — showing each app's local AI settings only. Refresh in a minute."
              : "Couldn't reach the AI engine for the task catalogue just now — usage numbers below are live. Refresh in a minute."}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Jobs (7 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats ? stats.totals.jobs : '—'}</div>
            {stats?.totals.truncated && (
              <p className="text-muted-foreground mt-1 text-xs">showing latest 2000</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Succeeded / Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats ? (
                <>
                  <span className="text-green-600">{stats.totals.done}</span>
                  <span className="text-muted-foreground text-xl"> / </span>
                  <span className={stats.totals.error > 0 ? 'text-red-600' : ''}>
                    {stats.totals.error}
                  </span>
                </>
              ) : (
                '—'
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Apps with AI on
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {enabledCount}
              <span className="text-muted-foreground text-xl"> / {apps.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">₹0</div>
            <p className="text-muted-foreground mt-1 text-xs">Max lane — by design</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apps</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>AI</TableHead>
                <TableHead>Approved tasks</TableHead>
                <TableHead className="text-right">Jobs 7d</TableHead>
                <TableHead className="text-right">Avg turnaround</TableHead>
                <TableHead className="text-right">Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((app) => {
                const ai = app.settings?.ai;
                const s = statsByApp.get(app.slug);
                return (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">{app.name}</TableCell>
                    <TableCell>
                      {ai?.enabled === true ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          on
                        </Badge>
                      ) : (
                        <Badge variant="outline">off</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      {ai?.enabled === true && (ai.allowed_tasks?.length ?? 0) > 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {(ai.allowed_tasks ?? [])
                            .map((k) => taskLabel.get(k) ?? k)
                            .join(' · ')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s?.jobs ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {s?.avg_turnaround_secs != null ? `${s.avg_turnaround_secs}s` : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">
                      {ago(s?.last_run ?? null)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {apps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    No applications yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Task catalogue{catalogue ? ` (${catalogue.length})` : ''}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Every task MyJKKN currently lets an external app run, read live from the
            engine. These are the tasks you can tick for an app on its edit screen.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Lane</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider / model</TableHead>
                <TableHead className="text-right">Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(catalogue ?? []).map((t) => (
                <TableRow key={t.job_type}>
                  <TableCell>
                    <div className="font-medium">{t.title ?? t.job_type}</div>
                    <code className="text-muted-foreground text-xs">{t.job_type}</code>
                    {t.description && (
                      <p className="text-muted-foreground mt-0.5 max-w-[420px] text-xs">
                        {t.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.lane ?? '—'}</Badge>
                  </TableCell>
                  <TableCell>
                    {t.enabled ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                        enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline">disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {t.provider ?? '—'}
                    {t.model_id ? ` · ${t.model_id}` : ''}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {t.expected_seconds != null ? `${t.expected_seconds}s` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {(catalogue ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {catalogue ? 'No tasks are external-allowed yet.' : 'Engine unreachable.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent AI jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Turnaround</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stats?.recent ?? []).map((j) => (
                <TableRow key={j.job_id}>
                  <TableCell className="font-medium">{j.app_id}</TableCell>
                  <TableCell>
                    <code className="text-xs">{j.task}</code>
                  </TableCell>
                  <TableCell>{statusBadge(j.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {j.turnaround_secs != null ? `${j.turnaround_secs}s` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right">
                    {ago(j.requested_at)}
                  </TableCell>
                </TableRow>
              ))}
              {(!stats || stats.recent.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {stats ? 'No AI jobs yet.' : 'Engine unreachable.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
