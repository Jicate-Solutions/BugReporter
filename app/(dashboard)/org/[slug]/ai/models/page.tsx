/**
 * AI Models — the JICATE AI engine's recipes, the model each one uses, and
 * what each has cost (always ₹0: the engine runs on the Max-plan Claude CLI on
 * the JICATE Windows box, and there is no paid path). "API price" is what the
 * Claude API would have charged for the same runs (ai_usage.api_cost_usd), the
 * base for per-app billing; it is blank for runs recorded before 24 Oct 2026.
 *
 * Modelled on MyJKKN's /admin/ai-models, cut down to what this engine has:
 * one row per task in `ai_tasks`, with its 30-day usage from `ai_usage`, and a
 * "usage by model" panel. Platform admins can switch a task on or off, pick
 * its model, mark whether a person waits for it, and set its limits. The
 * recipe wording is shown but not editable here (it carries safety rules).
 *
 * AI task builder (2026-10-24): developers of an app can also create tasks for
 * their apps and draft recipe edits (live only after a passing test), see each
 * task's version history, restore a version, and switch a task off. Hidden
 * until the 20261024_ai_task_builder migration is applied.
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
import {
  buildableApps,
  canSeeTask,
  isBuilder,
  loadActor,
  readTaskBuilderMeta,
  type BuildableApp
} from '@/lib/ai-engine/task-builder';
import { EngineTaskEditor } from './_components/engine-task-editor';
import { NewTaskDialog } from './_components/new-task-dialog';
import { TaskBuilderPanel } from './_components/task-builder-panel';
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
  const priced = rows.filter((r) => r.api_cost_usd != null);
  const apiUsd = priced.length ? priced.reduce((s, r) => s + Number(r.api_cost_usd), 0) : null;
  return { runs, failed, cost, avgSecs, tokensOut, apiUsd };
}

/** One clock read, outside render. */
function anyWorkerAlive(runners: RunnerRow[]) {
  const now = Date.now();
  return runners.some((r) => runnerAlive(r, now));
}

function rupees(n: number) {
  return `₹${n.toFixed(n === 0 ? 0 : 2)}`;
}

/** API price: what the Claude API would have charged (we pay ₹0 per run on Max). */
function usd(n: number | null) {
  return n == null ? '—' : `$${n.toFixed(n < 1 ? 4 : 2)}`;
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

  // ── AI task builder (null meta = migration not applied: builder hidden) ──
  const meta = await readTaskBuilderMeta(admin);
  const actor = meta && user ? await loadActor(admin, user.id) : null;
  const myApps: BuildableApp[] = actor ? await buildableApps(admin, actor) : [];
  const builder = actor ? isBuilder(actor) : false;
  const metaRows = meta ? [...meta.values()] : [];
  const ownerIds = [...new Set(metaRows.map((m) => m.created_by).filter(Boolean))] as string[];
  const ownerAppIds = [...new Set(metaRows.map((m) => m.owner_app).filter(Boolean))] as string[];
  const [ownerRows, ownerAppRows] = await Promise.all([
    ownerIds.length
      ? admin.from('profiles').select('id, email, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] }),
    ownerAppIds.length
      ? admin.from('applications').select('id, name, organization_id').in('id', ownerAppIds)
      : Promise.resolve({ data: [] })
  ]);
  const ownerName = new Map(
    ((ownerRows.data ?? []) as { id: string; email: string | null; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name || p.email || 'a former member']
    )
  );
  // Another organisation's app name is not shown to people outside it.
  const appName = new Map(
    ((ownerAppRows.data ?? []) as { id: string; name: string; organization_id: string }[]).map(
      (a) => [
        a.id,
        actor &&
        (actor.superAdmin || actor.orgRoles.has(a.organization_id) || actor.appRoles.has(a.id))
          ? a.name
          : 'an app in another organisation'
      ]
    )
  );

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
          { label: 'API price (we pay ₹0)', value: usd(total.apiUsd) },
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
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Tasks</CardTitle>
          {meta && myApps.length > 0 && (
            <NewTaskDialog
              apps={myApps.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {tasks.length === 0 && (
            <p className="text-muted-foreground text-sm">No tasks on the JICATE engine yet.</p>
          )}
          {!meta && canEdit && (
            <p className="text-muted-foreground text-xs">
              The AI task builder (new tasks, drafts, version history) appears here once the
              20261024_ai_task_builder migration is applied.
            </p>
          )}
          {tasks.map((t) => {
            const s = summarise(usageByTask.get(t.job_type) ?? []);
            const m = meta?.get(t.job_type);
            const showBuilder = Boolean(
              m && actor && canSeeTask(actor, { owner_app: m.owner_app })
            );
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
                  <span>{rupees(s.cost)} · API price {usd(s.apiUsd)}</span>
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
                {showBuilder && m && actor && (
                  <TaskBuilderPanel
                    jobType={t.job_type}
                    enabled={t.enabled}
                    ownerLabel={m.created_by ? ownerName.get(m.created_by) ?? 'a former member' : 'platform (no owner)'}
                    appLabel={m.owner_app ? appName.get(m.owner_app) ?? 'a removed app' : 'shared by all apps'}
                    canEdit={builder}
                    canSwitchOff
                    superAdmin={actor.superAdmin}
                    recipe={{
                      title: t.title,
                      description: t.description ?? '',
                      instructions: t.instructions,
                      model: t.model,
                      effort: t.effort ?? null,
                      output_format: t.output_format,
                      interactive: t.interactive,
                      max_inflight: t.max_inflight,
                      max_payload_bytes: t.max_payload_bytes,
                      timeout_seconds: t.timeout_seconds,
                      max_answer_words: t.max_answer_words,
                      required_inputs: m.required_inputs,
                      queue_wait_seconds: m.queue_wait_seconds
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
              Only platform admins can change the settings above directly. Developers change a
              task by saving a draft, which goes live after a test run passes.
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
                  <TableHead className="text-right">API price</TableHead>
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
                      <TableCell className="text-right">{usd(s.apiUsd)}</TableCell>
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
