/**
 * Internal AI route — the dashboard's own door to the ₹0 Max lane.
 *
 * Unlike the public /api/v1/public/ai/run door (which authenticates external
 * apps by X-API-Key), this route authenticates a signed-in reporter USER by
 * session and scopes every call to an organization the user is a member of.
 *
 *   POST /api/internal/ai   { kind, organizationId, ... }  → 202 { job_id }
 *   GET  /api/internal/ai?job_id=…&organizationId=…        → poll status/result
 *
 * kind='brief'  → server computes THIS org's fleet numbers and asks ops.brief
 *                 for a plain-English briefing. The client never supplies the
 *                 numbers, so it cannot smuggle another org's data in.
 * kind='triage' → summarize / suggest_fix / categorize a single bug that the
 *                 caller's org owns (RLS-checked read).
 *
 * Isolation: the engine app_id is ALWAYS `reporter-<organizationId>`, derived
 * server-side from a membership check — never from a client-supplied value.
 * A poll for a job that belongs to another org returns NULL from the engine
 * (fn_ai_external_result matches on app_id), so cross-org reads are impossible.
 *
 * Cost: forwarded to MyJKKN's engine on lane=max → ₹0 (no paid path exists).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRIAGE_TASKS = ['bug.summarize', 'bug.suggest_fix', 'bug.categorize'];

function engineConfig(): { base: string; key: string } | null {
  const base = process.env.MYJKKN_AI_URL;
  const key = process.env.MYJKKN_AI_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ''), key };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Resolve the signed-in user and confirm they are a member of `organizationId`.
 * The session client's RLS on `organizations` only returns rows for orgs the
 * user belongs to, so a non-member gets null → 403.
 */
async function requireMember(organizationId: string) {
  if (!UUID_RE.test(organizationId)) {
    return { error: err('BAD_REQUEST', 'organizationId (uuid) is required.', 400) };
  }
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: err('UNAUTHENTICATED', 'Sign in to use AI features.', 401) };
  }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .single();
  if (!org) {
    return { error: err('FORBIDDEN', 'You are not a member of this organization.', 403) };
  }
  return { supabase, org: org as { id: string; name: string } };
}

const appIdFor = (organizationId: string) => `reporter-${organizationId}`;

// ── Fleet-stats builder (server-side, org-scoped) for kind='brief' ──────────

type BugRow = {
  application_id: string | null;
  status: string | null;
  category: string | null;
  created_at: string;
  resolved_at: string | null;
};

async function buildFleetStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  orgName: string,
  scope?: { applicationId?: string; appName?: string }
): Promise<string> {
  const applicationId = scope?.applicationId;
  const appName = scope?.appName;
  const PAGE = 1000;
  const bugs: BugRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('bug_reports')
      .select('application_id, status, category, created_at, resolved_at')
      .eq('organization_id', organizationId);
    if (applicationId) q = q.eq('application_id', applicationId);
    const { data, error } = await q
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BugRow[];
    bugs.push(...rows);
    if (rows.length < PAGE) break;
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const isClosed = (s: string | null) => s === 'wont_fix';
  const isActive = (s: string | null) => s !== 'resolved' && !isClosed(s);
  const monthAgo = now - 30 * day;

  const total = bugs.length;
  const active = bugs.filter((b) => isActive(b.status)).length;
  const stale = bugs.filter(
    (b) => isActive(b.status) && new Date(b.created_at).getTime() < monthAgo
  ).length;
  const new30 = bugs.filter((b) => new Date(b.created_at).getTime() > monthAgo).length;
  const resolved30 = bugs.filter(
    (b) => b.status === 'resolved' && b.resolved_at && new Date(b.resolved_at).getTime() > monthAgo
  ).length;

  const catCounts = new Map<string, number>();
  for (const b of bugs) {
    const c = b.category ?? 'other';
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const catLine = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${n} ${c}`)
    .join(', ');
  const securityActive = bugs.filter(
    (b) => b.category === 'security' && isActive(b.status)
  ).length;

  // Noisiest apps by total, resolve app names.
  const byApp = new Map<string, number>();
  for (const b of bugs) {
    if (!b.application_id) continue;
    byApp.set(b.application_id, (byApp.get(b.application_id) ?? 0) + 1);
  }
  const topAppIds = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const appsReporting = byApp.size;
  let namesById = new Map<string, string>();
  if (topAppIds.length > 0) {
    const { data: apps } = await supabase
      .from('applications')
      .select('id, name')
      .in(
        'id',
        topAppIds.map(([id]) => id)
      );
    namesById = new Map((apps ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
  }
  const noisiest = topAppIds
    .map(([id, n]) => `${namesById.get(id) ?? 'Unknown'} ${n}`)
    .join(', ');

  const lines = [
    appName
      ? `App "${appName}" — total bugs: ${total}.`
      : `Total bugs across ${appsReporting} reporting apps: ${total}.`,
    `Open (active) now: ${active}; of these ${stale} have been open longer than 30 days.`,
    `Last 30 days: ${new30} new vs ${resolved30} resolved (backlog change ${new30 - resolved30 >= 0 ? '+' : ''}${new30 - resolved30}).`,
    `Categories: ${catLine || 'none'}.`,
    `Open security bugs: ${securityActive}.`
  ];
  // "Noisiest apps" is meaningless when scoped to a single app.
  if (!appName) lines.push(`Noisiest apps: ${noisiest || 'none'}.`);
  lines.push(
    appName ? `Organization: ${orgName} (scope: app "${appName}").` : `Organization: ${orgName}.`
  );
  return lines.join('\n');
}

// ── POST — enqueue ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const engine = engineConfig();
  if (!engine) {
    return err('AI_NOT_CONFIGURED', 'The AI engine is not configured on the platform yet.', 503);
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    organizationId?: string;
    applicationId?: string;
    bugId?: string;
    task?: string;
  } | null;
  if (!body) return err('BAD_REQUEST', 'JSON body required.', 400);

  const gate = await requireMember(body.organizationId ?? '');
  if ('error' in gate) return gate.error;
  const { supabase, org } = gate;
  const appId = appIdFor(org.id);

  let task: string;
  let payload: Record<string, string>;
  let dedupeKey: string | undefined;

  if (body.kind === 'brief') {
    task = 'ops.brief';
    // Optional single-app scope: verify the app belongs to THIS org (so a
    // member can't point the briefing at another org's app), then narrow the
    // read to that app. The engine app_id stays reporter-<orgId> — unchanged.
    let appName: string | undefined;
    if (body.applicationId !== undefined) {
      if (!UUID_RE.test(body.applicationId)) {
        return err('BAD_REQUEST', 'applicationId must be a uuid.', 400);
      }
      const { data: app } = await supabase
        .from('applications')
        .select('id, name')
        .eq('id', body.applicationId)
        .eq('organization_id', org.id)
        .single();
      if (!app) {
        return err('NOT_FOUND', 'No such application in this organization.', 404);
      }
      appName = (app as { name: string }).name;
    }
    let stats: string;
    try {
      stats = await buildFleetStats(supabase, org.id, org.name, {
        applicationId: body.applicationId,
        appName
      });
    } catch {
      return err('STATS_FAILED', 'Could not read the bug numbers.', 500);
    }
    payload = { org: appName ? `${org.name} — ${appName}` : org.name, stats };
  } else if (body.kind === 'triage') {
    task = typeof body.task === 'string' ? body.task : '';
    if (!TRIAGE_TASKS.includes(task)) {
      return err('BAD_REQUEST', `task must be one of: ${TRIAGE_TASKS.join(', ')}`, 400);
    }
    if (!body.bugId || !UUID_RE.test(body.bugId)) {
      return err('BAD_REQUEST', 'bugId (uuid) is required for triage.', 400);
    }
    // RLS scopes this read to the caller's org; a foreign bug returns null.
    const { data: bug } = await supabase
      .from('bug_reports')
      .select('id, display_id, description, page_url, metadata, application_id')
      .eq('id', body.bugId)
      .eq('organization_id', org.id)
      .single();
    if (!bug) return err('NOT_FOUND', 'No such bug in this organization.', 404);
    const meta = (bug.metadata as { title?: string } | null) ?? {};
    let appName = 'Unknown app';
    if (bug.application_id) {
      const { data: app } = await supabase
        .from('applications')
        .select('name')
        .eq('id', bug.application_id)
        .single();
      if (app?.name) appName = app.name;
    }
    payload = {
      app: appName,
      title: meta.title || bug.display_id || 'Untitled bug',
      description: bug.description || '',
      context: bug.page_url || ''
    };
    dedupeKey = `${task}:${bug.id}`;
  } else {
    return err('BAD_REQUEST', "kind must be 'brief' or 'triage'.", 400);
  }

  try {
    const upstream = await fetch(`${engine.base}/api/b2a/ai/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${engine.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ app_id: appId, task, payload, ...(dedupeKey ? { dedupe_key: dedupeKey } : {}) }),
      cache: 'no-store'
    });
    const data = (await upstream.json().catch(() => null)) as {
      job_id?: string;
      error?: { code?: string; message?: string };
    } | null;
    if (upstream.status === 202 && data?.job_id) {
      return NextResponse.json({ job_id: data.job_id, status: 'queued', retry_after: 15 }, { status: 202 });
    }
    return err(
      data?.error?.code ?? 'UPSTREAM_ERROR',
      data?.error?.message ?? 'The AI engine refused the request.',
      upstream.status >= 500 ? 502 : upstream.status
    );
  } catch {
    return err('AI_UNAVAILABLE', 'Could not reach the AI engine. Try again shortly.', 502);
  }
}

// ── GET — poll ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const engine = engineConfig();
  if (!engine) {
    return err('AI_NOT_CONFIGURED', 'The AI engine is not configured on the platform yet.', 503);
  }
  const url = new URL(request.url);
  const jobId = url.searchParams.get('job_id') ?? '';
  const organizationId = url.searchParams.get('organizationId') ?? '';
  if (!UUID_RE.test(jobId)) return err('BAD_REQUEST', 'job_id (uuid) is required.', 400);

  const gate = await requireMember(organizationId);
  if ('error' in gate) return gate.error;
  const appId = appIdFor(gate.org.id);

  try {
    const upstream = await fetch(
      `${engine.base}/api/b2a/ai/run?job_id=${jobId}&app_id=${encodeURIComponent(appId)}`,
      { headers: { Authorization: `Bearer ${engine.key}` }, cache: 'no-store' }
    );
    const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
    if (upstream.ok && data) return NextResponse.json(data, { status: 200 });
    if (upstream.status === 404) {
      return err('NOT_FOUND', 'No such job for this organization.', 404);
    }
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    return err(
      e?.code ?? 'UPSTREAM_ERROR',
      e?.message ?? 'The AI engine refused the request.',
      upstream.status >= 500 ? 502 : upstream.status
    );
  } catch {
    return err('AI_UNAVAILABLE', 'Could not reach the AI engine. Try again shortly.', 502);
  }
}
