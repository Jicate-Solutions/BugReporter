/**
 * The client triage lane — claim and complete, server side.
 *
 * The Windows runner never touches the database. It calls two routes that run
 * this code with the platform's own service-role client:
 *
 *   claim    → fn_triage_claim (advisory lock + SKIP LOCKED, stale re-queue),
 *              then a MINIMAL view of the bug: no reporter name or email, no
 *              screenshot or attachments, no network trace, a trimmed console
 *              excerpt, and the page URL without its query string.
 *   complete → write ONE internal note on the bug's thread (author 'ai'), read
 *              it back, and only then mark the job done. Any failure before that
 *              leaves the job retryable. The bug's status is never changed.
 *
 * Both functions take the client as an argument so tests can pass a fake.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { TRIAGE_KIND } from './enqueue';

export const MAX_ATTEMPTS = 3;

const CONSOLE_MAX_ENTRIES = 20;
const CONSOLE_MAX_LINE = 300;
const CONSOLE_MAX_TOTAL = 2000;
const DESCRIPTION_MAX = 4000;
const SIMILAR_MAX = 3;
const SIMILAR_SNIPPET = 200;

// ── claim ────────────────────────────────────────────────────────────────────

export interface SimilarBugSummary {
  display_id: string | null;
  title: string | null;
  status: string | null;
  snippet: string;
}

export interface ClaimedTriageJob {
  job_id: string;
  attempts: number;
  bug: {
    display_id: string | null;
    title: string | null;
    description: string;
    page_url: string | null;
    category: string | null;
    console_excerpt: string;
  };
  app_name: string;
  similar: SimilarBugSummary[];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Origin + path only: query strings and fragments often carry tokens. */
export function stripUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return clip(raw.split(/[?#]/)[0], 300);
  }
}

/**
 * The last few console lines, errors and warnings first, as plain text.
 * console_logs is the SDK's [{level, message, timestamp}] array.
 */
export function consoleExcerpt(logs: unknown): string {
  if (!Array.isArray(logs) || logs.length === 0) return '';
  const entries = logs
    .filter((e): e is { level?: unknown; message?: unknown } => !!e && typeof e === 'object')
    .map((e) => ({
      level: typeof e.level === 'string' ? e.level : 'log',
      message: typeof e.message === 'string' ? e.message : JSON.stringify(e.message ?? '')
    }));
  const loud = entries.filter((e) => e.level === 'error' || e.level === 'warn');
  const chosen = (loud.length > 0 ? loud : entries).slice(-CONSOLE_MAX_ENTRIES);
  const lines: string[] = [];
  let total = 0;
  for (const e of chosen) {
    const line = `${e.level}: ${clip(e.message.replace(/\s+/g, ' ').trim(), CONSOLE_MAX_LINE)}`;
    if (total + line.length > CONSOLE_MAX_TOTAL) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

/**
 * Up to three earlier bugs from the SAME app. find_similar_bugs is scoped to
 * the organization, so rows from other apps are dropped here. Best effort: a
 * bug without an embedding yet (they are generated after intake) gets none.
 */
async function similarFromSameApp(
  admin: SupabaseClient,
  bugId: string,
  applicationId: string
): Promise<SimilarBugSummary[]> {
  try {
    const { data, error } = await admin.rpc('find_similar_bugs', {
      target_bug_id: bugId,
      min_similarity: 0.75,
      max_results: 15
    });
    if (error || !Array.isArray(data)) return [];
    return (
      data as {
        display_id: string | null;
        title: string | null;
        description: string | null;
        status: string | null;
        application_id: string | null;
      }[]
    )
      .filter((row) => row.application_id === applicationId)
      .slice(0, SIMILAR_MAX)
      .map((row) => ({
        display_id: row.display_id ?? null,
        title: row.title ? clip(row.title, 120) : null,
        status: row.status ?? null,
        snippet: clip((row.description ?? '').replace(/\s+/g, ' ').trim(), SIMILAR_SNIPPET)
      }));
  } catch {
    return [];
  }
}

/** Mark a claimed job retryable (or failed once it has used its attempts). */
export async function releaseJob(
  admin: SupabaseClient,
  job: { id: string; attempts: number },
  reason: string
): Promise<void> {
  const exhausted = job.attempts >= MAX_ATTEMPTS;
  await admin
    .from('triage_jobs')
    .update({
      status: exhausted ? 'failed' : 'queued',
      claimed_by: null,
      claimed_at: null,
      error: clip(reason, 500),
      completed_at: exhausted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', job.id)
    .eq('status', 'claimed');
}

/** Claim at most one job. null = nothing to do. */
export async function claimTriageJob(
  admin: SupabaseClient,
  runner: string
): Promise<ClaimedTriageJob | null> {
  const { data, error } = await admin.rpc('fn_triage_claim', {
    p_runner: runner,
    p_kind: TRIAGE_KIND,
    p_max_attempts: MAX_ATTEMPTS
  });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as {
    id: string;
    bug_report_id: string;
    application_id: string;
    attempts: number;
  }[];
  const job = rows[0];
  if (!job) return null;

  // Named columns only. `metadata` is read for its title alone, server side —
  // it also holds reporter_name, reporter_email and the network trace, none of
  // which leave this function.
  const { data: bug, error: bugErr } = await admin
    .from('bug_reports')
    .select('id, display_id, description, page_url, category, console_logs, metadata, application_id')
    .eq('id', job.bug_report_id)
    .maybeSingle();
  if (bugErr || !bug) {
    await releaseJob(admin, job, bugErr ? `bug read failed: ${bugErr.message}` : 'bug not found');
    throw new Error('could not read the bug for this job');
  }

  const { data: app } = await admin
    .from('applications')
    .select('name')
    .eq('id', job.application_id)
    .maybeSingle();

  const meta = (bug.metadata ?? {}) as { title?: unknown };
  return {
    job_id: job.id,
    attempts: job.attempts,
    bug: {
      display_id: (bug.display_id as string | null) ?? null,
      title: typeof meta.title === 'string' ? clip(meta.title, 200) : null,
      description: clip(String(bug.description ?? ''), DESCRIPTION_MAX),
      page_url: stripUrl(bug.page_url),
      category: (bug.category as string | null) ?? null,
      console_excerpt: consoleExcerpt(bug.console_logs)
    },
    app_name: ((app as { name?: string } | null)?.name ?? 'Unknown app').slice(0, 120),
    similar: await similarFromSameApp(admin, job.bug_report_id, job.application_id)
  };
}

// ── complete ─────────────────────────────────────────────────────────────────

const oneLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(max));

export const verdictSchema = z.object({
  type: z.enum(['bug', 'duplicate', 'feature_request', 'needs_info']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: oneLine(240),
  likely_area: oneLine(120),
  confidence: z.number().min(0).max(1)
});

export type TriageVerdict = z.infer<typeof verdictSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const completeBodySchema = z.union([
  z.object({ job_id: z.string().regex(UUID_RE), verdict: verdictSchema }),
  // The runner's way to say "the model gave me nothing usable": releases the
  // claim now instead of waiting for the stale timeout.
  z.object({ job_id: z.string().regex(UUID_RE), error: z.string().min(1).max(1000) })
]);

export type CompleteBody = z.infer<typeof completeBodySchema>;

const TYPE_LABEL: Record<TriageVerdict['type'], string> = {
  bug: 'Bug',
  duplicate: 'Possible duplicate',
  feature_request: 'Feature request',
  needs_info: 'Needs more information'
};

export const AI_NOTE_HEADER = 'AI triage (automatic, not checked by a person)';

export function formatTriageNote(v: TriageVerdict): string {
  return [
    AI_NOTE_HEADER,
    `Type: ${TYPE_LABEL[v.type]} · Severity: ${v.severity} · Confidence: ${Math.round(v.confidence * 100)}%`,
    `Summary: ${v.summary}`,
    `Likely area: ${v.likely_area}`
  ].join('\n');
}

export type CompleteOutcome =
  | { status: 200; body: { job_id: string; status: 'done' | 'queued' | 'failed'; message_id?: string } }
  | { status: 404 | 409 | 500 | 502; body: { error: { code: string; message: string } } };

const outErr = (status: 404 | 409 | 500 | 502, code: string, message: string): CompleteOutcome => ({
  status,
  body: { error: { code, message } }
});

export async function completeTriageJob(
  admin: SupabaseClient,
  input: CompleteBody
): Promise<CompleteOutcome> {
  const { data: job, error: jobErr } = await admin
    .from('triage_jobs')
    .select('id, bug_report_id, status, attempts, created_at')
    .eq('id', input.job_id)
    .maybeSingle();
  if (jobErr) return outErr(500, 'READ_FAILED', 'Could not read the job.');
  if (!job) return outErr(404, 'NOT_FOUND', 'No such triage job.');
  if (job.status !== 'claimed') {
    return outErr(409, 'NOT_CLAIMED', `Job is ${job.status}, not claimed.`);
  }

  if ('error' in input) {
    await releaseJob(admin, job, `runner: ${input.error}`);
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    return { status: 200, body: { job_id: job.id, status: exhausted ? 'failed' : 'queued' } };
  }

  const verdict = input.verdict;
  const text = formatTriageNote(verdict);

  // A previous attempt may have written the note and then failed to mark the
  // job done. Reuse that note rather than posting a second one.
  let messageId: string | null = null;
  const { data: prior } = await admin
    .from('bug_report_messages')
    .select('id')
    .eq('bug_report_id', job.bug_report_id)
    .eq('author_kind', 'ai')
    .gte('created_at', job.created_at)
    .limit(1);
  if (Array.isArray(prior) && prior[0]?.id) messageId = prior[0].id as string;

  if (!messageId) {
    const { data: created, error: insErr } = await admin
      .from('bug_report_messages')
      .insert({
        bug_report_id: job.bug_report_id,
        sender_user_id: null,
        author_kind: 'ai',
        author_email: null,
        message_text: text,
        message_type: 'system',
        // Team-only: the reporter-facing portal and public API never show it.
        is_internal: true
      })
      .select('id')
      .single();
    if (insErr || !created) {
      await releaseJob(admin, job, `note write failed: ${insErr?.message ?? 'no row'}`);
      return outErr(502, 'WRITE_FAILED', 'Could not write the AI note; the job will be retried.');
    }
    messageId = created.id as string;
  }

  // Read it back: the job is only done once the note is provably there.
  const { data: readBack, error: readErr } = await admin
    .from('bug_report_messages')
    .select('id, bug_report_id')
    .eq('id', messageId)
    .maybeSingle();
  if (readErr || !readBack || readBack.bug_report_id !== job.bug_report_id) {
    await releaseJob(admin, job, 'note read-back failed');
    return outErr(502, 'READBACK_FAILED', 'The AI note could not be confirmed; the job will be retried.');
  }

  const { data: doneRows, error: doneErr } = await admin
    .from('triage_jobs')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
      result: { ...verdict, message_id: messageId }
    })
    .eq('id', job.id)
    .eq('status', 'claimed')
    .select('id');
  if (doneErr || !Array.isArray(doneRows) || doneRows.length === 0) {
    // The note exists; the next attempt will find and reuse it.
    return outErr(500, 'MARK_DONE_FAILED', 'The note was written but the job could not be marked done.');
  }

  return { status: 200, body: { job_id: job.id, status: 'done', message_id: messageId } };
}
