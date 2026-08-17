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
 */
export interface AiTask {
  key: string;
  label: string;
  description: string;
}

/**
 * Offline default — a snapshot of MyJKKN's external_allowed rows on 2026-08-08.
 * Used when the engine can't be reached, and as the static list the public
 * enqueue gate checks against (see app/api/v1/public/ai/run/route.ts).
 *
 * `yip.questionnaire_score` was added AHEAD of its catalogue row rather than
 * copied back from one, because the enqueue gate above rejects any key missing
 * here regardless of what the live catalogue says. It is not drift — do not
 * prune it for being absent from `ai_job_types` until that row is seeded.
 */
export const FALLBACK_AI_TASKS = [
  {
    key: 'bug.summarize',
    label: 'Summarize a bug',
    description: 'Plain-English summary + likely area + severity guess'
  },
  {
    key: 'bug.suggest_fix',
    label: 'Suggest a fix',
    description: 'Root-cause hypotheses + concrete fix steps'
  },
  {
    key: 'bug.categorize',
    label: 'Categorize a bug',
    description: 'Strict-JSON severity/category tags for machine use'
  },
  {
    key: 'ops.brief',
    label: 'Ops brief',
    description: 'Operational briefing summary'
  },
  {
    key: 'reply.draft',
    label: 'Reply — draft a corrected social reply (external)',
    description: 'Rewrite a rejected Instagram/Facebook bot reply'
  },
  {
    key: 'yip.questionnaire_score',
    label: 'YIP — score a selection questionnaire (external)',
    description: 'Strict-JSON rubric scores for one candidate paper'
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
 */
export async function getAvailableAiTasks(): Promise<AiTask[]> {
  const catalogue = await fetchAiJobTypeCatalogue();
  if (!catalogue || catalogue.length === 0) {
    return FALLBACK_AI_TASKS.map((t) => ({ ...t }));
  }
  return catalogue.map((row) => ({
    key: row.job_type,
    label: row.title ?? row.job_type,
    description: row.description ?? ''
  }));
}
