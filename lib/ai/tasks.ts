/**
 * AI Door — the task "set menu".
 *
 * THE LIVE CATALOGUE IS THE SOURCE OF TRUTH, NOT THIS FILE. Every runnable task
 * is a row in MyJKKN's `ai_job_types`, read through
 * GET /api/b2a/ai/job-types?external_only=1 (see getAvailableAiTasks below).
 *
 * This file used to hold a hand-copied mirror of that list, with a comment
 * claiming it "mirrors the external_allowed recipes seeded in MyJKKN". The
 * mirror drifted, exactly as hand-copied mirrors do: MyJKKN had FIVE
 * external_allowed recipes while this copy still named three, so `ops.brief`
 * and `reply.draft` were invisible platform-wide — no admin could tick them and
 * no app could run them.
 *
 * FALLBACK_AI_TASKS survives only as the degraded default: if the engine is
 * unreachable the platform must still render a task menu rather than an empty
 * list, and the enqueue gate must still recognise the keys it knew about. It is
 * a SNAPSHOT taken 2026-08-08, never the definition — if it disagrees with the
 * live catalogue, the live catalogue is right and this array is stale.
 *
 * Per-app approval lives in applications.settings.ai.allowed_tasks; an app can
 * only run tasks that appear BOTH in the catalogue and in its own list.
 */

/**
 * A task as the UI renders it. Keys are `string`, not a closed union: the live
 * catalogue can add a task without a deploy here, which is the entire point.
 *
 * `enabled` mirrors the engine's own switch. The catalogue endpoint filters on
 * external_allowed but NOT on enabled, so a task MyJKKN has switched off still
 * arrives here — the UI marks it rather than hiding it, so an approval screen
 * never silently loses a row (Director decision, 2026-08-08).
 */
export interface AiTask {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

/**
 * Offline default — a verbatim snapshot of MyJKKN's five external_allowed rows,
 * read from production on 2026-08-08. Labels and descriptions are copied from
 * the live `ai_job_types` rows on purpose: when the engine is reachable the UI
 * shows those exact strings, so an outage must not rename the same task.
 *
 * Used when the engine can't be reached, and as the static list the public
 * enqueue gate checks against (see app/api/v1/public/ai/run/route.ts).
 */
export const FALLBACK_AI_TASKS = [
  {
    key: 'bug.summarize',
    label: 'Bug — plain-English summary (external)',
    description: 'External-app task: summarize a bug report for a busy developer.',
    enabled: true
  },
  {
    key: 'bug.suggest_fix',
    label: 'Bug — root cause + fix suggestion (external)',
    description:
      'External-app task: hypothesize root cause and suggest fix steps for a bug report.',
    enabled: true
  },
  {
    key: 'bug.categorize',
    label: 'Bug — severity + category tags (external)',
    description:
      'External-app task: classify a bug report; returns strict JSON for machine use.',
    enabled: true
  },
  {
    key: 'ops.brief',
    label: 'Fleet health briefing',
    description:
      'Reads the whole bug board and writes a plain-English manager briefing (status + priorities + risks).',
    enabled: true
  },
  {
    key: 'reply.draft',
    label: 'Reply — draft a corrected social reply (external)',
    description:
      'External-app task: rewrite a rejected Instagram/Facebook bot reply.',
    enabled: true
  }
] as const;

export type AiTaskKey = (typeof FALLBACK_AI_TASKS)[number]['key'];

export const AI_TASK_KEYS: string[] = FALLBACK_AI_TASKS.map((t) => t.key);

/**
 * One row of MyJKKN's catalogue. Only the fields this platform actually renders
 * are typed; the endpoint returns more. `prompt_template` is deliberately
 * absent — we never request it (see fetchAiJobTypeCatalogue).
 */
export interface AiJobType {
  job_type: string;
  title: string | null;
  description: string | null;
  lane: string | null;
  enabled: boolean;
  external_allowed: boolean;
  interactive: boolean;
  schedulable: boolean;
  provider: string | null;
  model_id: string | null;
  max_inflight: number | null;
  expected_seconds: number | null;
  updated_at: string | null;
}

/**
 * Read the live job-type catalogue from MyJKKN.
 *
 * SERVER-SIDE ONLY — it reads MYJKKN_AI_KEY. Client components must go through
 * GET /api/internal/ai/job-types instead, which calls this behind a session
 * check so the key never reaches a browser bundle. (This module stays free of
 * `import 'server-only'` because the constants above are imported by client
 * code; non-NEXT_PUBLIC env vars are `undefined` in the browser, so the key
 * cannot leak even if this function were bundled.)
 *
 * Returns null — never throws — when the engine is unreachable or misconfigured,
 * mirroring fetchEngineStats() on the AI cockpit page: a degraded engine must
 * degrade the page, not break it.
 *
 * We never send ?include=prompt: prompt_template is the wording of MyJKKN's
 * internal recipes and nothing on this platform needs it to render a menu.
 */
export async function fetchAiJobTypeCatalogue(): Promise<AiJobType[] | null> {
  const base = process.env.MYJKKN_AI_URL;
  const key = process.env.MYJKKN_AI_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/b2a/ai/job-types?external_only=1`,
      {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store'
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { job_types?: AiJobType[] } | null;
    return Array.isArray(data?.job_types) ? data.job_types : null;
  } catch {
    return null;
  }
}

/**
 * The task menu to render, live if possible and the 2026-08-08 snapshot if not.
 *
 * SERVER-SIDE ONLY (calls fetchAiJobTypeCatalogue). A row with no title falls
 * back to its key so a half-filled catalogue row still renders something
 * identifiable rather than an empty label.
 *
 * `live` matters to callers, it is not decoration. Only a LIVE list can prove
 * that a task an app was approved for has been withdrawn from MyJKKN; against
 * the snapshot, every task added since 2026-08-08 would look withdrawn. Any UI
 * that flags stale approvals must check this flag first.
 */
export async function getAvailableAiTasks(): Promise<{
  tasks: AiTask[];
  live: boolean;
}> {
  const catalogue = await fetchAiJobTypeCatalogue();
  if (!catalogue || catalogue.length === 0) {
    return { tasks: FALLBACK_AI_TASKS.map((t) => ({ ...t })), live: false };
  }
  return {
    tasks: catalogue.map((row) => ({
      key: row.job_type,
      label: row.title ?? row.job_type,
      description: row.description ?? '',
      // Absent/null is treated as usable; only an explicit false marks it off.
      enabled: row.enabled !== false
    })),
    live: true
  };
}
