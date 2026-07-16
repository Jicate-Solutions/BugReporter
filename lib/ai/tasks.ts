/**
 * AI Door — the task "set menu".
 *
 * Every AI task an app can be approved for. Mirrors the external_allowed
 * recipes seeded in MyJKKN's ai_job_types (the ₹0 Max-lane engine).
 * Per-app approval lives in applications.settings.ai.allowed_tasks;
 * an app can only run tasks that appear BOTH here and in its own list.
 */

export const AVAILABLE_AI_TASKS = [
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
  }
] as const;

export type AiTaskKey = (typeof AVAILABLE_AI_TASKS)[number]['key'];

export const AI_TASK_KEYS: string[] = AVAILABLE_AI_TASKS.map((t) => t.key);
