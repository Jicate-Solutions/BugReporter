/**
 * AI Models — the JICATE AI engine's recipes, the model each one uses, and
 * what each has cost (always ₹0: the engine runs on the Max-plan Claude CLI on
 * the JICATE Windows box, and there is no paid path).
 *
 * Modelled on MyJKKN's /admin/ai-models, cut down to what this engine has:
 * one row per task in `ai_tasks`, with its 30-day usage from `ai_usage`, and a
 * "usage by model" panel. Platform admins can switch a task on or off, pick
 * its model, mark whether a person waits for it, and set its limits. The
 * recipe wording is shown but not editable here (it carries safety rules).
 *
 * Server component. Membership is checked session-side (RLS), then data is
 * read with the service client and filtered to this organisation.
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
  isSuperAdmin,
  readEngineTasks,
  readRunners,
  readUsage,
  runnerAlive,
  type RunnerRow,
  type UsageRow
} from '@/lib/ai-engine/admin';
import { AI_TASK_KEYS } from '@/lib/ai/tasks';
import { EngineTaskEditor } from './_components/engine-task-editor';
import { SafetyAlertBanner } from '../safety/_components/safety-alert-banner';

export const dynamic = 'force-dynamic';

const DAYS = 30;

function summarise(rows: UsageRow[]) {
  const runs = rows.length;
  const failed = rows.filter((r) => !r.success).length;
  const cost = rows.reduce((s, r) => s + Number(r.cost_inr || 0), 0);
  const durations = rows.filter((r) => r.success && r.duration_ms != null).map((r) => r.duration_ms!);
  const avgSecs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 100) / 10
    : null;
  const tokensOut = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
  return { runs, failed, cost, avgSecs, tokensOut };
}

/** One clock read, outside render. */
function anyWorkerAlive(runners: RunnerRow[]) {
  const now = Date.now();
  return runners.some((r) => runnerAlive(r, now));
}

function rupees(n: number) {
  return `₹${n.toFixed(n === 0 ? 0 : 2)}`;
}

export default async function AiModelsPage({
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
  const [tasks, usage, canEdit, runners] = await Promise.all([
    readEngineTasks(admin),
    readUsage(admin, org.id, DAYS),
    user ? isSuperAdmin(admin, user.id) : Promise.resolve(false),
    readRunners(admin)
  ]);
  const workerAlive = anyWorkerAlive(runners);

  const usageByTask = new Map<string, UsageRow[]>();
  const usageByModel = new Map<string, UsageRow[]>();
  for (const u of usage) {
    usageByTask.set(u.job_type, [...(usageByTask.get(u.job_type) ?? []), u]);
    const m = u.model_id ?? 'unknown';
    usageByModel.set(m, [...(usageByModel.get(m) ?? []), u]);
  }
  const total = summarise(usage);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Models</h1>
        <p className="text-muted-foreground text-sm">
          JICATE&apos;s own AI engine: which tasks it runs, on which model, and what they cost.
          Runs on the Max plan on the JICATE Windows box, so every run is ₹0. A task switched
          off here, or not listed, still runs on MyJKKN&apos;s engine; switching it on moves it
          here for every app at once.{' '}
          <Link href={`/org/${slug}/ai/routines`} className="underline">
            See the workers and queue
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: `Runs (${DAYS} days)`, value: String(total.runs) },
          { label: 'Failed runs', value: String(total.failed) },
          { label: 'Cost', value: rupees(total.cost) },
          { label: 'Average answer time', value: total.avgSecs != null ? `${total.avgSecs}s` : '—' }
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SafetyAlertBanner admin={admin} userId={user?.id} slug={slug} />

      {!workerAlive && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          No JICATE worker is running right now. Tasks switched on here will wait until the
          Windows workers check in, and switching another task on is blocked until they do.{' '}
          <Link href={`/org/${slug}/ai/routines`} className="underline">
            Check the workers
          </Link>
          .
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {tasks.length === 0 && (
            <p className="text-muted-foreground text-sm">No tasks on the JICATE engine yet.</p>
          )}
          {tasks.map((t) => {
            const s = summarise(usageByTask.get(t.job_type) ?? []);
            return (
              <div key={t.job_type} className="space-y-3 border-b pb-6 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  <code className="text-muted-foreground text-xs">{t.job_type}</code>
                  {t.enabled ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                      on · JICATE engine
                    </Badge>
                  ) : AI_TASK_KEYS.includes(t.job_type) ? (
                    <Badge variant="secondary">off · MyJKKN still serves it</Badge>
                  ) : (
                    <Badge variant="secondary">off</Badge>
                  )}
                  <Badge variant="outline">{t.model}</Badge>
                  {t.effort && <Badge variant="outline">effort: {t.effort}</Badge>}
                  {t.interactive && <Badge variant="outline">person waiting</Badge>}
                </div>
                {t.description && (
                  <p className="text-muted-foreground text-sm">{t.description}</p>
                )}
                <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>
                    {s.runs} runs, {s.failed} failed
                  </span>
                  <span>avg {s.avgSecs != null ? `${s.avgSecs}s` : '—'}</span>
                  <span>{rupees(s.cost)}</span>
                  <span>
                    up to {t.max_inflight} at once · {t.timeout_seconds}s limit ·{' '}
                    {Math.round(t.max_payload_bytes / 1024)} KB max input
                    {t.max_answer_words ? ` · ${t.max_answer_words} words max` : ''}
                  </span>
                </div>
                {canEdit && (
                  <EngineTaskEditor
                    task={{
                      job_type: t.job_type,
                      enabled: t.enabled,
                      model: t.model,
                      effort: t.effort ?? null,
                      interactive: t.interactive,
                      max_inflight: t.max_inflight,
                      timeout_seconds: t.timeout_seconds
                    }}
                  />
                )}
                <details className="text-sm">
                  <summary className="text-muted-foreground cursor-pointer">
                    Recipe rules (read only)
                  </summary>
                  <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                    {t.instructions}
                  </pre>
                </details>
              </div>
            );
          })}
          {!canEdit && tasks.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Only platform admins can change these settings.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by model ({DAYS} days)</CardTitle>
        </CardHeader>
        <CardContent>
          {usageByModel.size === 0 ? (
            <p className="text-muted-foreground text-sm">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Words out (tokens)</TableHead>
                  <TableHead className="text-right">Avg time</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...usageByModel.entries()].map(([model, rows]) => {
                  const s = summarise(rows);
                  return (
                    <TableRow key={model}>
                      <TableCell className="font-mono text-xs">{model}</TableCell>
                      <TableCell className="text-right">{s.runs}</TableCell>
                      <TableCell className="text-right">{s.failed}</TableCell>
                      <TableCell className="text-right">{s.tokensOut}</TableCell>
                      <TableCell className="text-right">
                        {s.avgSecs != null ? `${s.avgSecs}s` : '—'}
                      </TableCell>
                      <TableCell className="text-right">{rupees(s.cost)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
