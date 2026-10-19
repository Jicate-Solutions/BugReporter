/**
 * Internal route — which candidate duplicate PAIRS a human has already decided.
 *
 * The dupe-scan proposer (AiDuplicateFinderCard) surfaces embedding-similar bug
 * PAIRS as weak, machine-made guesses. Once a human confirms or dismisses a pair,
 * that verdict lands in `similarity_feedback` — and the proposer must stop
 * re-suggesting it, for EVERYONE on the team, not just the person who decided it.
 *
 * `similarity_feedback` RLS is per-user (`auth.uid() = user_id`), so a browser
 * session can only ever see its OWN verdicts. Cross-user exclusion therefore
 * needs a privileged read. This route provides exactly that — and nothing more:
 * after verifying the caller is a MEMBER of the organization (the session
 * client's RLS on `organizations` returns the row only for members), it uses the
 * service-role client to return the set of already-decided pair keys, scoped at
 * the database to that org (and optionally one app) by joining each verdict to
 * its own bug's organization.
 *
 * Read-only. Returns only pair KEYS ("<idA>|<idB>", ids sorted) — never any bug
 * content — so there is nothing sensitive to leak across the org boundary.
 *
 *   GET /api/internal/bug-reports/decided-pairs?organizationId=…[&applicationId=…]
 *     → 200 { decidedKeys: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Stable unordered key for a pair — matches the proposer's `[a, b].sort().join('|')`. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId') ?? '';
  const applicationId = url.searchParams.get('applicationId') ?? '';

  if (!UUID_RE.test(organizationId)) {
    return err('BAD_REQUEST', 'organizationId (uuid) is required.', 400);
  }
  if (applicationId && !UUID_RE.test(applicationId)) {
    return err('BAD_REQUEST', 'applicationId must be a uuid.', 400);
  }

  // Membership gate: the session client's RLS returns this org only if the
  // signed-in user belongs to it. A non-member (or signed-out user) gets null.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in to view duplicate suggestions.', 401);

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .single();
  if (!org) return err('FORBIDDEN', 'You are not a member of this organization.', 403);

  // Cross-user read: service-role, but scoped AT THE DATABASE to the verified org
  // (and optional app) by inner-joining each verdict to its own bug. No other
  // org's rows are ever fetched into memory.
  const admin = createAdminClient();
  let query = admin
    .from('similarity_feedback')
    .select(
      'bug_report_id, suggested_bug_id, bug:bug_reports!similarity_feedback_bug_report_id_fkey!inner(organization_id, application_id)'
    )
    .eq('bug.organization_id', organizationId);
  if (applicationId) query = query.eq('bug.application_id', applicationId);

  const { data, error } = await query;
  if (error) {
    // Surface the failure — never let a broken read masquerade as "no decisions".
    return err('READ_FAILED', 'Could not read duplicate decisions.', 500);
  }

  const rows = (data ?? []) as unknown as Array<{
    bug_report_id: string;
    suggested_bug_id: string;
  }>;
  const decidedKeys = Array.from(
    new Set(rows.map((r) => pairKey(r.bug_report_id, r.suggested_bug_id)))
  );

  return NextResponse.json({ decidedKeys }, { status: 200 });
}
