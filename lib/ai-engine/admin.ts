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
    .select('name, last_seen_at, last_job_at')
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
