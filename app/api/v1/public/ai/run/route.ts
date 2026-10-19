/**
 * Public AI door — run pre-approved AI tasks on the ₹0 Max lane.
 *
 * POST /api/v1/public/ai/run                 Enqueue a task → 202 { job_id }
 * GET  /api/v1/public/ai/run?job_id=…        Poll status/result (own jobs only)
 *
 * Auth: the app's existing X-API-Key (same key as bug reporting).
 * Gating (per Director decisions 2026-07-16):
 *   1. settings.ai.enabled must be true for the app  → else 403 ai_not_enabled
 *   2. task must be in settings.ai.allowed_tasks     → else 403 task_not_permitted
 * Then the request is forwarded to MyJKKN's engine (/api/b2a/ai/run) using the
 * platform's single MYJKKN_AI_KEY. Individual apps never hold a MyJKKN key.
 * app_id = the application's slug — derived server-side from the API key,
 * never from anything the caller sends (cross-app isolation).
 *
 * No paid fallback exists anywhere on this path: jobs queue behind MyJKKN's
 * own work (priority 500 vs 100) and run at ₹0 when the Max box is free.
 *
 * JICATE AI engine (2026-10-19): a task that is switched ON in this platform's
 * own `ai_tasks` table runs on the JICATE engine instead (lib/ai-engine/engine.ts),
 * drained by the JICATE Windows box. Same gates, same request, same poll
 * envelope — an app cannot tell which engine answered. GET checks this
 * platform's queue first and falls back to MyJKKN for any other job id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse
} from '@/lib/middleware/api-key-auth';
import { AI_TASK_KEYS } from '@/lib/ai/tasks';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  enqueueEngineJob,
  getEngineTask,
  readEngineResult
} from '@/lib/ai-engine/engine';
import {
  enforceRateLimit,
  AI_RUN_RATE_LIMIT
} from '@/lib/middleware/rate-limit';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AiSettings {
  enabled?: boolean;
  allowed_tasks?: string[];
  /** Per-app override of the 30/min AI run limit (e.g. Plug the Leak: a whole class asks at once). */
  runs_per_minute?: number;
}

function engineConfig(): { base: string; key: string } | null {
  const base = process.env.MYJKKN_AI_URL;
  const key = process.env.MYJKKN_AI_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ''), key };
}

/** Fresh read of the app's AI settings (middleware context doesn't carry settings). */
async function readAiSettings(applicationId: string): Promise<AiSettings> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data } = await supabase
    .from('applications')
    .select('settings')
    .eq('id', applicationId)
    .single();
  const ai = (data?.settings as { ai?: AiSettings } | null)?.ai;
  return ai && typeof ai === 'object' ? ai : {};
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-api-key'
      }
    }
  );
}

// ─── POST — enqueue a task ──────────────────────────────────────────────────

export const POST = withApiKeyAuth(async (request: NextRequest, context) => {
  // Per-app throttle, before any body parsing or enqueue. GET polling is
  // deliberately NOT limited: an SDK polls every few seconds while a job runs.
  // An app may carry its own limit in settings.ai.runs_per_minute (1-1000).
  const ai = await readAiSettings(context.application.id);
  const perMinute =
    Number.isInteger(ai.runs_per_minute) && ai.runs_per_minute! >= 1 && ai.runs_per_minute! <= 1000
      ? ai.runs_per_minute!
      : AI_RUN_RATE_LIMIT.applicationPerWindow;
  const limited = await enforceRateLimit(context, 'ai:run', {
    ...AI_RUN_RATE_LIMIT,
    applicationPerWindow: perMinute
  });
  if (limited) return limited;

  let body: {
    task?: unknown;
    payload?: unknown;
    dedupe_key?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    return createApiErrorResponse('BAD_REQUEST', 'Invalid JSON body.', 400);
  }

  const task = body?.task;
  if (typeof task !== 'string' || task.length === 0) {
    return createApiErrorResponse(
      'BAD_REQUEST',
      `task is required. Available tasks: ${AI_TASK_KEYS.join(', ')}`,
      400
    );
  }

  // Gate 1+2: per-app AI switch + per-app task menu (fresh read above, not cached)
  if (ai.enabled !== true) {
    return createApiErrorResponse(
      'ai_not_enabled',
      'AI is not switched on for this app. Ask the platform admin to enable it.',
      403
    );
  }
  const allowed = Array.isArray(ai.allowed_tasks) ? ai.allowed_tasks : [];

  // Which engine owns this task? A row in ai_tasks = the JICATE engine.
  let engineTask: Awaited<ReturnType<typeof getEngineTask>> = null;
  try {
    engineTask = await getEngineTask(createAdminClient(), task);
  } catch {
    return createApiErrorResponse(
      'AI_UNAVAILABLE',
      'Could not reach the AI engine. Try again shortly.',
      502
    );
  }

  // A task the JICATE engine has but has switched OFF goes back to MyJKKN when
  // MyJKKN serves it (the five tasks staged for the move); a JICATE-only task
  // that is off (leak.coach) is refused below with task_switched_off.
  const myjkknTask = AI_TASK_KEYS.includes(task);
  if (!allowed.includes(task) || (!engineTask && !myjkknTask)) {
    return createApiErrorResponse(
      'task_not_permitted',
      `Task "${task}" is not in this app's approved menu. Approved: ${
        allowed.length ? allowed.join(', ') : '(none yet)'
      }`,
      403
    );
  }

  const payload =
    body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {};
  const dedupeKey =
    typeof body?.dedupe_key === 'string' && body.dedupe_key.length <= 200
      ? body.dedupe_key
      : undefined;

  if (engineTask && !engineTask.enabled && !myjkknTask) {
    return createApiErrorResponse(
      'task_switched_off',
      `Task "${task}" is switched off on the platform right now.`,
      503
    );
  }

  // ── JICATE engine path (task switched ON there) ──
  if (engineTask?.enabled) {
    try {
      const out = await enqueueEngineJob(createAdminClient(), {
        jobType: task,
        applicationId: context.application.id,
        appSlug: context.application.slug,
        organizationId: context.application.organization_id,
        payload: payload as Record<string, unknown>,
        dedupeKey
      });
      if (out.ok) {
        return createApiSuccessResponse(
          { job_id: out.job_id, status: 'queued', retry_after: out.interactive ? 3 : 30 },
          202
        );
      }
      if (out.error === 'payload_too_large') {
        return createApiErrorResponse(
          'payload_too_large',
          `payload is larger than this task allows (${out.max_bytes} bytes).`,
          413
        );
      }
      if (out.error === 'task_switched_off') {
        return createApiErrorResponse(
          'task_switched_off',
          `Task "${task}" is switched off on the platform right now.`,
          503
        );
      }
      return createApiErrorResponse('task_not_permitted', `Task "${task}" is not available.`, 403);
    } catch {
      return createApiErrorResponse(
        'AI_UNAVAILABLE',
        'Could not reach the AI engine. Try again shortly.',
        502
      );
    }
  }

  // ── MyJKKN engine path (unchanged) ──
  const engine = engineConfig();
  if (!engine) {
    return createApiErrorResponse(
      'AI_NOT_CONFIGURED',
      'The AI door is not configured on the platform yet (missing engine URL/key).',
      503
    );
  }

  try {
    const upstream = await fetch(`${engine.base}/api/b2a/ai/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${engine.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Identity comes from the validated API key, never the request body.
        app_id: context.application.slug,
        task,
        payload,
        ...(dedupeKey ? { dedupe_key: dedupeKey } : {})
      }),
      cache: 'no-store'
    });
    const data = (await upstream.json().catch(() => null)) as {
      job_id?: string;
      error?: { code?: string; message?: string };
    } | null;

    if (upstream.status === 202 && data?.job_id) {
      return createApiSuccessResponse(
        { job_id: data.job_id, status: 'queued', retry_after: 30 },
        202
      );
    }

    return createApiErrorResponse(
      data?.error?.code ?? 'UPSTREAM_ERROR',
      data?.error?.message ?? 'The AI engine refused the request.',
      upstream.status >= 500 ? 502 : upstream.status
    );
  } catch {
    return createApiErrorResponse(
      'AI_UNAVAILABLE',
      'Could not reach the AI engine. Try again shortly.',
      502
    );
  }
});

// ─── GET — poll status/result ───────────────────────────────────────────────

export const GET = withApiKeyAuth(async (request: NextRequest, context) => {
  const jobId = new URL(request.url).searchParams.get('job_id') ?? '';
  if (!UUID_RE.test(jobId)) {
    return createApiErrorResponse('BAD_REQUEST', 'job_id (uuid) is required.', 400);
  }

  // ── JICATE engine first: same envelope MyJKKN returns ──
  try {
    const row = await readEngineResult(createAdminClient(), jobId, context.application.slug);
    if (row) {
      const done = row.status === 'done' || row.status === 'error';
      return createApiSuccessResponse(
        {
          job_id: jobId,
          status: row.status,
          ...(row.status === 'done' ? { result: row.result ?? null } : {}),
          ...(row.status === 'error' ? { error: row.error ?? 'job failed' } : {}),
          ...(done ? {} : { retry_after: row.interactive ? 3 : 30 }),
          requested_at: row.requested_at,
          completed_at: row.completed_at ?? null
        },
        200
      );
    }
  } catch {
    // Not a fall-through: MyJKKN would answer "no such job" for a JICATE job.
    return createApiErrorResponse(
      'AI_UNAVAILABLE',
      'Could not read the job right now. Try again shortly.',
      502
    );
  }

  // ── MyJKKN engine (unchanged) ──
  const engine = engineConfig();
  if (!engine) {
    return createApiErrorResponse(
      'AI_NOT_CONFIGURED',
      'The AI door is not configured on the platform yet (missing engine URL/key).',
      503
    );
  }

  try {
    const upstream = await fetch(
      `${engine.base}/api/b2a/ai/run?job_id=${jobId}&app_id=${encodeURIComponent(
        context.application.slug
      )}`,
      {
        headers: { Authorization: `Bearer ${engine.key}` },
        cache: 'no-store'
      }
    );
    const data = (await upstream.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (upstream.ok && data) {
      return createApiSuccessResponse(data, 200);
    }
    if (upstream.status === 404) {
      return createApiErrorResponse('NOT_FOUND', 'No such job for this app.', 404);
    }
    const err = (data as { error?: { code?: string; message?: string } } | null)
      ?.error;
    return createApiErrorResponse(
      err?.code ?? 'UPSTREAM_ERROR',
      err?.message ?? 'The AI engine refused the request.',
      upstream.status >= 500 ? 502 : upstream.status
    );
  } catch {
    return createApiErrorResponse(
      'AI_UNAVAILABLE',
      'Could not reach the AI engine. Try again shortly.',
      502
    );
  }
});
