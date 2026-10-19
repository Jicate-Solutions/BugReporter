/**
 * AI Routines — every AI job on the JICATE engine for this organisation, in
 * one place: are the workers alive, how deep is the queue, what ran lately,
 * and which scheduled routines feed it.
 *
 * Modelled on MyJKKN's /admin/ai-routines (queue health + max-lane workers),
 * cut down to this engine. Scheduled routines themselves are managed on the
 * existing Scheduled routines page; this page lists them and links there.
 *
 * Server component. Membership is checked session-side (RLS); jobs are read
 * with the service client and filtered to this organisation. No payload or
 * answer is ever shown here: ids, timings and status only.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
import {
  ago,
  readLiveQueue,
  readRecentJobs,
  readRunners,
  runnerAlive,
  secondsBetween,
  type JobRow,
  type RunnerRow,
  isSuperAdmin
} from '@/lib/ai-engine/admin';
import { SafetyAlertBanner } from '../safety/_components/safety-alert-banner';
import { RunnerAccountEditor } from './_components/runner-account-editor';

export const dynamic = 'force-dynamic';

function statusBadge(status: string) {
  if (status === 'done')
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">done</Badge>;
  if (status === 'error') return <Badge variant="destructive">error</Badge>;
  if (status === 'running') return <Badge variant="outline">running</Badge>;
  return <Badge variant="secondary">waiting</Badge>;
}

/** One clock read per request, outside render, for every "ago" on the page. */
function queueStats(runners: RunnerRow[], live: JobRow[], recent: JobRow[]) {
  const now = Date.now();
  const waiting = live.filter((j) => j.status === 'queued');
  const running = live.filter((j) => j.status === 'running');
  const dayAgo = now - 86_400_000;
  return {
    now,
    aliveCount: runners.filter((r) => runnerAlive(r, now)).length,
    waiting,
    running,
    oldestWait: waiting.length
      ? Math.round((now - new Date(waiting[0].requested_at).getTime()) / 1000)
      : null,
    errors24h: recent.filter(
      (j) => j.status === 'error' && new Date(j.requested_at).getTime() > dayAgo
    ).length
  };
}

interface ScheduledRoutine {
  id: string;
  routine_kind: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  applications: { name: string } | { name: string }[] | null;
}

export default async function AiRoutinesPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

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

  const {
    data: { user }
  } = await session.auth.getUser();
  const admin = createAdminClient();
  const [runners, live, recent, scheduledRes, canEdit] = await Promise.all([
    readRunners(admin),
    readLiveQueue(admin, org.id),
    readRecentJobs(admin, org.id, 50),
    admin
      .from('app_ai_routines')
      .select('id, routine_kind, enabled, last_run_at, last_status, applications(name)')
      .eq('organization_id', org.id)
      .order('routine_kind'),
    user ? isSuperAdmin(admin, user.id) : Promise.resolve(false)
  ]);
  const scheduled = (scheduledRes.data ?? []) as ScheduledRoutine[];

  const { now, aliveCount, waiting, running, oldestWait, errors24h } = queueStats(
    runners,
    live,
    recent
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Routines</h1>
        <p className="text-muted-foreground text-sm">
          Every AI job on JICATE&apos;s own engine for {org.name}: the workers on the JICATE
          Windows box, the queue, and what ran lately. Jobs where a person is waiting go first.{' '}
          <Link href={`/org/${slug}/ai/models`} className="underline">
            Tasks and models
          </Link>
          .
        </p>
      </div>

      <SafetyAlertBanner admin={admin} userId={user?.id} slug={slug} />

      {runners.length > 0 && aliveCount === 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          No worker has checked in for over 2 minutes. Jobs will wait until the JICATE Windows box
          is back.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: 'Workers alive', value: `${aliveCount} of ${runners.length}` },
          { label: 'Waiting', value: String(waiting.length) },
          { label: 'Running', value: String(running.length) },
          {
            label: 'Longest wait',
            value: oldestWait != null ? `${oldestWait}s` : '—',
            note: errors24h ? `${errors24h} failed in 24 h` : undefined
          }
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
              {c.note && <p className="text-muted-foreground mt-1 text-xs">{c.note}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workers</CardTitle>
        </CardHeader>
        <CardContent>
          {runners.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No worker has ever checked in. The JICATE Windows box is not set up yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last check-in</TableHead>
                  <TableHead>Last job</TableHead>
                  <TableHead>Claude account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runners.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-mono text-xs">{r.name}</TableCell>
                    <TableCell>
                      {runnerAlive(r, now) ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">alive</Badge>
                      ) : (
                        <Badge variant="secondary">silent</Badge>
                      )}
                    </TableCell>
                    <TableCell>{ago(r.last_seen_at, now)}</TableCell>
                    <TableCell>{ago(r.last_job_at, now)}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <RunnerAccountEditor
                          runner={{
                            name: r.name,
                            account: r.account,
                            account_fallback: r.account_fallback,
                            accounts_available: r.accounts_available ?? [],
                            account_in_use: r.account_in_use
                          }}
                        />
                      ) : (
                        <span className="text-sm">{r.account_in_use ?? r.account ?? 'default'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">No jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Waited</TableHead>
                  <TableHead className="text-right">Ran</TableHead>
                  <TableHead>Worker</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((j) => {
                  const waited = secondsBetween(j.requested_at, j.claimed_at);
                  const ran = secondsBetween(j.claimed_at, j.completed_at);
                  return (
                    <TableRow key={j.id}>
                      <TableCell>{ago(j.requested_at, now)}</TableCell>
                      <TableCell>{j.app_slug}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {j.job_type}
                        {j.attempts > 1 ? ` (try ${j.attempts})` : ''}
                      </TableCell>
                      <TableCell title={j.error ?? undefined}>{statusBadge(j.status)}</TableCell>
                      <TableCell className="text-right">{waited != null ? `${waited}s` : '—'}</TableCell>
                      <TableCell className="text-right">{ran != null ? `${ran}s` : '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{j.claimed_by ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled routines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scheduled.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scheduled routines yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Routine</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduled.map((r) => {
                  const app = Array.isArray(r.applications) ? r.applications[0] : r.applications;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.routine_kind}</TableCell>
                      <TableCell>{app?.name ?? 'All apps'}</TableCell>
                      <TableCell>
                        {r.enabled ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">on</Badge>
                        ) : (
                          <Badge variant="secondary">paused</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {ago(r.last_run_at, now)}
                        {r.last_status ? ` · ${r.last_status}` : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="text-muted-foreground text-xs">
            Scheduled routines still run on MyJKKN&apos;s engine until they are moved over.{' '}
            <Link href={`/org/${slug}/routines`} className="underline">
              Manage scheduled routines
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
