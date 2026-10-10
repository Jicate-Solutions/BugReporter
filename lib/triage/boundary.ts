/**
 * The data boundary between JICATE apps and CLIENT apps.
 *
 * Director rule (10 Oct 2026): bug text from client apps must never enter the
 * MyJKKN college database, not even briefly. Everything that forwards to
 * MyJKKN's AI engine (`${MYJKKN_AI_URL}/api/b2a/ai/run` — the AI Door routes and
 * the routines dispatcher) must therefore refuse an app whose
 * `applications.data_boundary` is 'client'. Client apps get the separate triage
 * lane (lib/triage/runner.ts) instead, which never leaves this database.
 *
 * Every check here FAILS CLOSED: if the boundary cannot be read, the app is
 * treated as a client app and the MyJKKN call does not happen. A refused AI
 * call is recoverable; a leaked bug report is not.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DataBoundary = 'jicate' | 'client';

export const CLIENT_BOUNDARY_CODE = 'client_data_boundary';

export const CLIENT_BOUNDARY_MESSAGE =
  "This is a client app. Its bug data must not be sent to MyJKKN's AI engine, so the AI Door is closed for it. Client apps are triaged by the separate client triage lane instead.";

/** Only the literal 'jicate' may use the MyJKKN AI Door. Anything else is client. */
export function isJicateBoundary(value: unknown): boolean {
  return value === 'jicate';
}

/**
 * Whether one application is a client app (fail closed: unreadable = client).
 * Works with either a service-role or a session client.
 */
export async function isClientApplication(
  supabase: SupabaseClient,
  applicationId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('applications')
    .select('data_boundary')
    .eq('id', applicationId)
    .maybeSingle();
  if (error || !data) return true;
  return !isJicateBoundary((data as { data_boundary?: unknown }).data_boundary);
}

/**
 * The ids of every client app in an organization, for org-wide reads that feed
 * the MyJKKN engine (fleet briefings): those reads drop client apps entirely.
 * Throws when the list cannot be read, so the caller sends nothing.
 */
export async function clientApplicationIds(
  supabase: SupabaseClient,
  organizationId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, data_boundary')
    .eq('organization_id', organizationId);
  if (error) {
    throw new Error(`could not read application data boundaries: ${error.message}`);
  }
  return new Set(
    ((data ?? []) as { id: string; data_boundary?: unknown }[])
      .filter((a) => !isJicateBoundary(a.data_boundary))
      .map((a) => a.id)
  );
}
