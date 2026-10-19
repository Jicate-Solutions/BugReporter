/**
 * JICATE AI engine — read helpers for the AI Models and AI Routines pages.
 *
 * Server-side only: every function takes the service-role client. The pages
 * call these AFTER their own org-membership check, and every job / usage read
 * is filtered to that organisation. Recipes and worker heartbeats are
 * platform-wide (one engine serves every org) and carry no app data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EngineTaskRow {
  job_type: string;
  title: string;
  description: string;
  instructions: string;
  model: string;
  output_format: 'text' | 'json';
  interactive: boolean;
  enabled: boolean;
  max_inflight: number;
  max_payload_bytes: number;
  timeout_seconds: number;
  max_answer_words: number | null;
  updated_at: string;
}

export interface UsageRow {
  job_type: string;
  model_id: string | null;
  success: boolean;
  cost_inr: number | string;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  invoked_at: string;
}

export interface RunnerRow {
  name: string;
  last_seen_at: string;
  last_job_at: string | null;
  /** Claude account label chosen for this worker; null = the box's own sign-in. */
  account: string | null;
  account_fallback: boolean;
  /** Labels the worker reported holding (names only). */
  accounts_available: string[];
  /** Label the last job actually ran on. */
  account_in_use: string | null;
  /** The Windows computer this worker runs on. */
  host: string | null;
}

export interface AccountRow {
  label: string;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  overage_enabled: boolean | null;
  reported_by: string | null;
  updated_at: string | null;
  priority: number | null;
}

/** Latest allowance reading per Claude account label. Platform admins only. */
export async function readAccounts(admin: SupabaseClient): Promise<AccountRow[]> {
  const { data } = await admin
    .from('ai_accounts')
    .select(
      'label, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, overage_enabled, reported_by, updated_at, priority'
    )
    .order('priority', { ascending: true, nullsFirst: false })
    .order('label');
  return ((data ?? []) as AccountRow[]).map((r) => ({
    ...r,
    five_hour_util: r.five_hour_util == null ? null : Number(r.five_hour_util),
    seven_day_util: r.seven_day_util == null ? null : Number(r.seven_day_util)
  }));
}

export interface JobRow {
  id: string;
  job_type: string;
  app_slug: string;
  status: 'queued' | 'running' | 'done' | 'error';
  interactive: boolean;
  attempts: number;
  claimed_by: string | null;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export async function readEngineTasks(admin: SupabaseClient): Promise<EngineTaskRow[]> {
  const { data } = await admin
    .from('ai_tasks')
    .select(
      'job_type, title, description, instructions, model, output_format, interactive, enabled, max_inflight, max_payload_bytes, timeout_seconds, max_answer_words, updated_at'
    )
    .order('job_type');
  return (data ?? []) as EngineTaskRow[];
}

/** Ledger rows for one org over the last `days` days (capped at 5000 rows). */
export async function readUsage(
  admin: SupabaseClient,
  organizationId: string,
  days: number
): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await admin
    .from('ai_usage')
    .select('job_type, model_id, success, cost_inr, duration_ms, input_tokens, output_tokens, invoked_at')
    .eq('organization_id', organizationId)
    .gte('invoked_at', since)
    .order('invoked_at', { ascending: false })
    .limit(5000);
  return (data ?? []) as UsageRow[];
}

export async function readRunners(admin: SupabaseClient): Promise<RunnerRow[]> {
  const { data } = await admin
    .from('ai_runners')
    .select('name, last_seen_at, last_job_at, account, account_fallback, accounts_available, account_in_use, host')
    .order('name');
  return (data ?? []) as RunnerRow[];
}

/** Recent jobs for one org, newest first. No payload, no result: ids and timings only. */
export async function readRecentJobs(
  admin: SupabaseClient,
  organizationId: string,
  limit = 50
): Promise<JobRow[]> {
  const { data } = await admin
    .from('ai_jobs')
    .select('id, job_type, app_slug, status, interactive, attempts, claimed_by, requested_at, claimed_at, completed_at, error')
    .eq('organization_id', organizationId)
    .order('requested_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as JobRow[];
}

/** Every job still waiting or running for one org (the live queue). */
export async function readLiveQueue(
  admin: SupabaseClient,
  organizationId: string
): Promise<JobRow[]> {
  const { data } = await admin
    .from('ai_jobs')
    .select('id, job_type, app_slug, status, interactive, attempts, claimed_by, requested_at, claimed_at, completed_at, error')
    .eq('organization_id', organizationId)
    .in('status', ['queued', 'running'])
    .order('requested_at')
    .limit(500);
  return (data ?? []) as JobRow[];
}

export async function isSuperAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from('super_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** A worker counts as alive if it checked in within the last 2 minutes. */
export function runnerAlive(r: RunnerRow, now = Date.now()): boolean {
  return now - new Date(r.last_seen_at).getTime() < 120_000;
}

export function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export interface SafetyAlertRow {
  id: string;
  job_id: string | null;
  job_type: string;
  app_slug: string;
  created_at: string;
  followed_up_at: string | null;
  /** What the learner sent and what the coach replied. Platform admins only. */
  payload: Record<string, unknown> | null;
  answer: string | null;
}

/**
 * Safety alerts across every organisation (platform admins only: the caller
 * checks isSuperAdmin first). Open ones first, then the latest followed-up.
 */
export async function readSafetyAlerts(admin: SupabaseClient): Promise<SafetyAlertRow[]> {
  const { data, error } = await admin
    .from('ai_safety_alerts')
    .select(
      'id, job_id, job_type, app_slug, created_at, followed_up_at, ai_jobs(payload, result)'
    )
    .order('followed_up_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return data.map((row) => {
    const j = (Array.isArray(row.ai_jobs) ? row.ai_jobs[0] : row.ai_jobs) as
      | { payload: Record<string, unknown> | null; result: { answer?: unknown } | null }
      | null
      | undefined;
    return {
      id: row.id,
      job_id: row.job_id,
      job_type: row.job_type,
      app_slug: row.app_slug,
      created_at: row.created_at,
      followed_up_at: row.followed_up_at,
      payload: j?.payload ?? null,
      answer: typeof j?.result?.answer === 'string' ? j.result.answer : null
    };
  });
}

/** How many alerts nobody has followed up yet. 0 on any error. */
export async function countOpenSafetyAlerts(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('ai_safety_alerts')
    .select('id', { count: 'exact', head: true })
    .is('followed_up_at', null);
  return error ? 0 : (count ?? 0);
}
