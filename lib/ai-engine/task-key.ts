/**
 * The AI task key (job_type) rules, with no server imports so the page's
 * "New AI task" dialog can show the key as the person types.
 */

/** Same rule as the ai_tasks CHECK constraint: one dot, letters/digits/_ only. */
export const JOB_TYPE_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const TASK_MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const;

/**
 * job_type = the owner app's slug + '.' + a lowercase name. Slugs may carry
 * hyphens and the column allows only letters, digits and '_', so both halves
 * are folded to that alphabet. "Summarize feedback" on yi-creative becomes
 * yi_creative.summarize_feedback.
 */
export function deriveJobType(
  appSlug: string,
  name: string
): { ok: true; jobType: string } | { ok: false; message: string } {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  let prefix = fold(appSlug);
  if (!prefix) return { ok: false, message: "This app's short name can't be used for a task key." };
  if (!/^[a-z]/.test(prefix)) prefix = `app_${prefix}`;
  const suffix = fold(name).slice(0, 40).replace(/_+$/, '');
  if (suffix.length < 2 || !/^[a-z]/.test(suffix)) {
    return {
      ok: false,
      message: 'Give the task a name that starts with a letter, for example "Summarize feedback".'
    };
  }
  const jobType = `${prefix}.${suffix}`;
  if (!JOB_TYPE_RE.test(jobType) || jobType.length > 80) {
    return { ok: false, message: 'That name makes a task key that is too long or not allowed.' };
  }
  return { ok: true, jobType };
}
