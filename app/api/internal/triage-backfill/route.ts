/**
 * POST /api/internal/triage-backfill  { applicationId, limit? }
 *
 * Queue triage jobs for an app's OPEN bugs that were filed before triage was
 * switched on, in small batches (default 25, max 50). Call it again until it
 * returns enqueued: 0. Safe to repeat: one job per bug, enforced by the table.
 *
 * Signed-in org owners/admins (or super admins) only — the same gate as
 * "Run now" on routines. It does nothing for an app without
 * settings.triage.enabled = true (any data boundary). The triage runner token does NOT work
 * here; this route only knows sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { backfillTriageJobs } from '@/lib/triage/enqueue';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data: sa } = await supabase.from('super_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (sa) return true;
  const { data: mem } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return !!mem && (mem.role === 'owner' || mem.role === 'admin');
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    applicationId?: string;
    limit?: number;
  } | null;
  if (!body?.applicationId || !UUID_RE.test(body.applicationId)) {
    return err('BAD_REQUEST', 'applicationId (uuid) is required.', 400);
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in to backfill triage.', 401);

  // RLS returns the app only to members of its organization.
  const { data: app } = await supabase
    .from('applications')
    .select('id, organization_id')
    .eq('id', body.applicationId)
    .maybeSingle();
  if (!app) return err('NOT_FOUND', 'No such application in your organizations.', 404);
  if (!(await isOrgAdmin(supabase, user.id, app.organization_id as string))) {
    return err('FORBIDDEN', 'Only org owners/admins can backfill triage.', 403);
  }

  try {
    const result = await backfillTriageJobs(
      createAdminClient(),
      app.id as string,
      typeof body.limit === 'number' ? body.limit : 25
    );
    if (!result.eligible) {
      return err(
        'TRIAGE_NOT_ENABLED',
        'Triage is not switched on for this app.',
        409
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('[triage-backfill] failed:', e instanceof Error ? e.message : e);
    return err('BACKFILL_FAILED', 'Could not queue the backfill.', 500);
  }
}
