// Server-only. Uses the service-role client, which bypasses RLS — never import
// this from a client component. createAdminClient() throws without
// SUPABASE_SERVICE_ROLE_KEY, which is not present in a browser bundle.
import { createAdminClient } from '@/lib/supabase/admin';
import { EmailService } from '@/lib/services/email/email.service';
import { enqueueWebhook } from '@/lib/webhooks/events';
import {
  isBugStatus,
  isTerminalBugStatus,
  isValidStatusTransition,
  bugStatusLabel,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';

/**
 * Who caused a status change.
 *
 *   dashboard_user — a logged-in platform user, from the dashboard
 *   api_key        — an integrated application, via the public API
 *   system         — automation (routines, bulk tooling)
 */
export type StatusActor =
  | { kind: 'dashboard_user'; userId: string; label?: string | null }
  | { kind: 'api_key'; label?: string | null }
  | { kind: 'system'; label?: string | null };

export interface ApplyStatusChangeInput {
  bugId: string;
  toStatus: string;
  note?: string | null;
  actor: StatusActor;
  /**
   * When set, the bug must belong to this application or the change is rejected
   * as NOT_FOUND. Public/API-key callers must always pass it — it is the tenant
   * boundary, and "not found" rather than "forbidden" avoids confirming that a
   * bug id exists in someone else's application.
   */
  applicationId?: string;
}

export type ApplyStatusChangeResult =
  | { ok: true; bug: Record<string, any>; fromStatus: BugReportStatus }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'INVALID_STATUS' | 'INVALID_TRANSITION' | 'DB_ERROR';
      message: string;
    };

/**
 * The single path through which bug_reports.status may be written.
 *
 * Every status write used to be an isolated UPDATE: the dashboard route, the
 * public API route, and a browser-side bulk update each did their own thing.
 * The previous status and the actor were discarded, `resolution_notes` was
 * accepted and then dropped, and nothing downstream was notified. Routing all
 * of them through here means history, notes, email, and webhooks cannot be
 * forgotten by a future caller.
 */
export async function applyStatusChange(
  input: ApplyStatusChangeInput
): Promise<ApplyStatusChangeResult> {
  const { bugId, note, actor, applicationId } = input;

  if (!isBugStatus(input.toStatus)) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: `Invalid status "${input.toStatus}".`,
    };
  }
  const toStatus: BugReportStatus = input.toStatus;

  const supabase = createAdminClient();

  const { data: bug, error: fetchError } = await supabase
    .from('bug_reports')
    .select(
      `
      id, display_id, status, resolved_at, page_url, metadata,
      organization_id, application_id, reporter_email,
      application:applications(id, name, slug, settings),
      organization:organizations(id, name)
    `
    )
    .eq('id', bugId)
    .single();

  if (fetchError || !bug) {
    return { ok: false, code: 'NOT_FOUND', message: 'Bug report not found.' };
  }

  // Tenant boundary. Checked before anything else is revealed about the bug.
  if (applicationId && bug.application_id !== applicationId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Bug report not found.' };
  }

  const fromStatus = (
    isBugStatus(bug.status) ? bug.status : 'new'
  ) as BugReportStatus;

  if (!isValidStatusTransition(fromStatus, toStatus)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Cannot move a bug from ${bugStatusLabel(
        fromStatus
      )} to ${bugStatusLabel(toStatus)}.`,
    };
  }

  // `resolved_at` is stamped when a bug ENTERS a terminal status, and is never
  // cleared. The previous implementation set it to null on every write and then
  // re-set it for terminal statuses, so reopening a bug silently destroyed the
  // original resolution timestamp that resolve-time analytics depend on.
  const updatePayload: Record<string, unknown> = { status: toStatus };
  if (isTerminalBugStatus(toStatus) && !isTerminalBugStatus(fromStatus)) {
    updatePayload.resolved_at = new Date().toISOString();
  }

  const { data: updatedBug, error: updateError } = await supabase
    .from('bug_reports')
    .update(updatePayload)
    .eq('id', bugId)
    .select(
      `
      *,
      application:applications(id, name, slug),
      organization:organizations(id, name)
    `
    )
    .single();

  if (updateError) {
    console.error('[bug-status] Update failed:', updateError);
    return {
      ok: false,
      code: 'DB_ERROR',
      message: updateError.message || 'Failed to update bug status.',
    };
  }

  const occurredAt = new Date().toISOString();
  const trimmedNote = note?.trim() || null;

  // ── history ────────────────────────────────────────────────────────────────
  const { error: eventError } = await supabase.from('bug_status_events').insert({
    bug_report_id: bugId,
    organization_id: bug.organization_id,
    application_id: bug.application_id,
    from_status: fromStatus,
    to_status: toStatus,
    note: trimmedNote,
    actor_kind: actor.kind,
    actor_user_id: actor.kind === 'dashboard_user' ? actor.userId : null,
    actor_label: actor.label ?? null,
    created_at: occurredAt,
  });
  if (eventError) {
    // Non-fatal: the status change already committed. Losing the audit row is
    // bad, but failing the request after the write would be worse.
    console.error('[bug-status] Failed to record status event:', eventError);
  }

  // ── the note becomes a visible message on the thread ───────────────────────
  if (trimmedNote) {
    const { error: noteError } = await supabase
      .from('bug_report_messages')
      .insert({
        bug_report_id: bugId,
        sender_user_id: actor.kind === 'dashboard_user' ? actor.userId : null,
        author_kind: 'system',
        message_text: trimmedNote,
        message_type: 'system',
        is_internal: false,
      });
    if (noteError) {
      console.error('[bug-status] Failed to persist status note:', noteError);
    }
  }

  // ── outbound ───────────────────────────────────────────────────────────────
  const application = Array.isArray(bug.application)
    ? bug.application[0]
    : bug.application;
  const organization = Array.isArray(bug.organization)
    ? bug.organization[0]
    : bug.organization;

  await enqueueWebhook(supabase, {
    organizationId: bug.organization_id,
    applicationId: bug.application_id,
    bugReportId: bugId,
    settings: application?.settings,
    payload: {
      event: 'bug.status_changed',
      bug: {
        id: bug.id,
        display_id: bug.display_id,
        page_url: bug.page_url,
        reporter_email: bug.reporter_email ?? null,
      },
      from_status: fromStatus,
      to_status: toStatus,
      note: trimmedNote,
      occurred_at: occurredAt,
    },
  });

  const reporterEmail = bug.reporter_email || bug.metadata?.reporter_email;
  if (reporterEmail) {
    EmailService.sendStatusUpdateNotification({
      reporterEmail,
      reporterName: bug.metadata?.reporter_name,
      bugId: bug.id,
      bugTitle: bug.metadata?.title || 'Bug Report',
      newStatus: toStatus,
      appName: application?.name || 'App',
      orgName: organization?.name || 'Organization',
      developerNote: trimmedNote ?? undefined,
      bugViewUrl: buildPortalBugUrl(application?.slug, reporterEmail),
    }).catch((err) =>
      console.error('[bug-status] Status email failed:', err)
    );
  }

  return { ok: true, bug: updatedBug, fromStatus };
}

/**
 * Deep link into the reporter's portal, when we know where it lives. Returns
 * undefined if the public URL isn't configured, in which case the email simply
 * omits the link rather than rendering a broken one.
 */
function buildPortalBugUrl(
  appSlug: string | undefined,
  reporterEmail: string
): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (!base || !appSlug) return undefined;
  return `${base}/portal/${appSlug}?u=${encodeURIComponent(reporterEmail)}`;
}
