// Server-only. Uses the service-role client, which bypasses RLS — never import
// this from a client component. createAdminClient() throws without
// SUPABASE_SERVICE_ROLE_KEY, which is not present in a browser bundle.
import { createAdminClient } from '@/lib/supabase/admin';
import { EmailService } from '@/lib/services/email/email.service';
import { resolveAppOwnerRecipient } from '@/lib/services/notifications/app-owner';
import { getBugPortalConfig } from '@/lib/services/bug-portal/config';
import { enqueueWebhook } from '@/lib/webhooks/events';
import {
  isBugStatus,
  isTerminalBugStatus,
  isReopenTransition,
  isValidStatusTransition,
  canActorSetStatus,
  canCloseFrom,
  bugStatusLabel,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';

/**
 * Who caused a status change.
 *
 *   dashboard_user — a logged-in platform user, from the dashboard
 *   api_key        — an integrated application, via the public API
 *   system         — automation (routines, bulk tooling)
 *   reporter       — the person who filed the bug, from the portal
 *
 * `reporter` carries an email rather than a userId because a reporter is not a
 * platform user and usually has no account at all — they are identified by the
 * portal's (application, email, signature) triple, nothing more.
 */
export type StatusActor =
  | { kind: 'dashboard_user'; userId: string; label?: string | null }
  | { kind: 'api_key'; label?: string | null }
  | { kind: 'system'; label?: string | null }
  | { kind: 'reporter'; email: string };

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
      code:
        | 'NOT_FOUND'
        | 'INVALID_STATUS'
        | 'INVALID_TRANSITION'
        | 'FORBIDDEN_ACTOR'
        | 'DB_ERROR';
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
      id, display_id, status, resolved_at, page_url, metadata, reopen_count,
      organization_id, application_id, reporter_email,
      application:applications(id, name, slug, settings),
      organization:organizations(id, name, slug)
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

  // Who is allowed to say this. The split between "the developer finished" and
  // "the client agrees" is only real if the two cannot set each other's status,
  // and a rule enforced in the portal's dropdown is a rule anyone can skip by
  // posting to the API. This is the one place every caller passes through.
  if (!canActorSetStatus(actor.kind, toStatus)) {
    return {
      ok: false,
      code: 'FORBIDDEN_ACTOR',
      message:
        actor.kind === 'reporter'
          ? `Only the team can move a report to ${bugStatusLabel(toStatus)}.`
          : `${bugStatusLabel(toStatus)} cannot be set from here.`,
    };
  }

  // Closing means "I tested the fix and it works", so there has to be a fix to
  // have tested. Without this a client could close a bug nobody had looked at,
  // which is the same hole that let 26 reports go straight from New to Resolved
  // with no developer involved.
  //
  // `resolved` counts as a fix to have tested (CLOSEABLE_FROM_STATUSES). It is
  // the legacy terminal state, and gating closure on `ready_for_testing` alone
  // left every bug logged before the split with no way to complete.
  if (toStatus === 'closed' && !canCloseFrom(fromStatus)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message:
        'A report can only be closed once the team has marked it ready for testing.',
    };
  }

  // Computed before the UPDATE so the reopen bookkeeping below can go into the
  // same write rather than needing a second round trip.
  const occurredAt = new Date().toISOString();
  const trimmedNote = note?.trim() || null;

  // `resolved_at` is stamped when a bug ENTERS a terminal status, and is never
  // cleared. The previous implementation set it to null on every write and then
  // re-set it for terminal statuses, so reopening a bug silently destroyed the
  // original resolution timestamp that resolve-time analytics depend on.
  const updatePayload: Record<string, unknown> = { status: toStatus };
  if (isTerminalBugStatus(toStatus) && !isTerminalBugStatus(fromStatus)) {
    updatePayload.resolved_at = occurredAt;
  }

  // Leaving a terminal status is a reopen, whoever did it — a reporter saying
  // "still broken" and a developer changing their mind are the same event as far
  // as this bug's history is concerned.
  //
  // The counter is a read-modify-write and so is racy in principle. It is a
  // display value only; bug_status_events is the authoritative trail, and a
  // reopen requires the bug to be terminal, so the team must act between any two
  // of them. Not worth an RPC to serialise.
  const isReopen = isReopenTransition(fromStatus, toStatus);
  if (isReopen) {
    updatePayload.reopened_at = occurredAt;
    updatePayload.reopen_count = (bug.reopen_count ?? 0) + 1;
    updatePayload.reopen_reason = trimmedNote;
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
    // A reporter has no label field — their email is the label.
    actor_label: actor.kind === 'reporter' ? actor.email : actor.label ?? null,
    created_at: occurredAt,
  });
  if (eventError) {
    // Non-fatal: the status change already committed. Losing the audit row is
    // bad, but failing the request after the write would be worse.
    console.error('[bug-status] Failed to record status event:', eventError);
  }

  // ── the note becomes a visible message on the thread ───────────────────────
  if (trimmedNote) {
    // Attribution matters here. A reporter's "still broken" reason is their own
    // words and must read as theirs — filing it as a system note would show it
    // back to them as if the team had written it, and would break the
    // last-author check the portal uses to decide who owes a reply.
    const fromReporter = actor.kind === 'reporter';

    const { error: noteError } = await supabase
      .from('bug_report_messages')
      .insert({
        bug_report_id: bugId,
        sender_user_id: actor.kind === 'dashboard_user' ? actor.userId : null,
        author_kind: fromReporter ? 'reporter' : 'system',
        author_email: fromReporter ? actor.email : null,
        message_text: trimmedNote,
        message_type: fromReporter ? 'text' : 'system',
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
      reopened: isReopen,
      actor_kind: actor.kind,
      occurred_at: occurredAt,
    },
  });

  const reporterEmail = bug.reporter_email || bug.metadata?.reporter_email;
  const bugTitle = bug.metadata?.title || 'Bug Report';

  // Notify whoever can act on this, which is not always the reporter.
  //
  // Every status change used to email the reporter. When the reporter is the one
  // who made the change, that emails them about their own click and tells the
  // team nothing — so a reopen would land in an empty room. Reporter-driven
  // changes go to the app owner instead.
  //
  // Which email they get keys on the EVENT, not the actor. When a reporter could
  // only ever reopen, those were the same question and this branch answered both
  // at once. They are not the same question now that a reporter can set any
  // status: sending the reopen template for a reporter marking their own bug
  // resolved would tell the owner someone disagrees with a fix, which is the
  // precise inverse of what happened.
  if (actor.kind === 'reporter') {
    const notify = isReopen
      ? notifyAppOwnerOfReopen({
          supabase,
          applicationId: bug.application_id,
          bugId: bug.id,
          displayId: bug.display_id,
          bugTitle,
          reason: trimmedNote,
          reporterEmail: actor.email,
          appName: application?.name || 'App',
          orgName: organization?.name || 'Organization',
          orgSlug: organization?.slug,
          pageUrl: bug.page_url || '',
          reopenCount: (updatedBug?.reopen_count as number) ?? 1,
          newStatus: toStatus,
        })
      : notifyAppOwnerOfReporterStatusChange({
          supabase,
          applicationId: bug.application_id,
          bugId: bug.id,
          displayId: bug.display_id,
          bugTitle,
          fromStatus,
          toStatus,
          note: trimmedNote,
          reporterEmail: actor.email,
          appName: application?.name || 'App',
          orgName: organization?.name || 'Organization',
          orgSlug: organization?.slug,
          pageUrl: bug.page_url || '',
        });

    notify.catch((err) =>
      console.error('[bug-status] Reporter status email failed:', err)
    );
  } else if (reporterEmail) {
    EmailService.sendStatusUpdateNotification({
      reporterEmail,
      reporterName: bug.metadata?.reporter_name,
      bugId: bug.id,
      bugTitle,
      newStatus: toStatus,
      appName: application?.name || 'App',
      orgName: organization?.name || 'Organization',
      developerNote: trimmedNote ?? undefined,
      bugViewUrl: buildPortalBugUrl(application?.slug, reporterEmail),
      // The email announcing "resolved" is the moment a reporter finds out, so
      // it is where the right of reply belongs — not only on a page they would
      // have to think to revisit.
      canReopen: getBugPortalConfig(application?.settings).allowReporterReopen,
    }).catch((err) =>
      console.error('[bug-status] Status email failed:', err)
    );
  }

  return { ok: true, bug: updatedBug, fromStatus };
}

/**
 * Fire-and-forget notification to the person who owns the application.
 *
 * Separate from applyStatusChange's main path because a missing owner, a deleted
 * auth user, or a Resend outage must never fail a status change that has already
 * committed.
 */
async function notifyAppOwnerOfReopen(input: {
  supabase: ReturnType<typeof createAdminClient>;
  applicationId: string;
  bugId: string;
  displayId: string;
  bugTitle: string;
  reason: string | null;
  reporterEmail: string;
  appName: string;
  orgName: string;
  orgSlug?: string;
  pageUrl: string;
  reopenCount: number;
  newStatus: string;
}): Promise<void> {
  const owner = await resolveAppOwnerRecipient(
    input.supabase,
    input.applicationId
  );
  if (!owner) {
    console.warn(
      `[bug-status] No app owner to notify about reopen of ${input.displayId}`
    );
    return;
  }

  await EmailService.sendBugReopenedNotification({
    dashboardUrl: buildDashboardUrl(input.orgSlug, input.bugId),
    developerEmail: owner.email,
    developerName: owner.name,
    bugId: input.bugId,
    displayId: input.displayId,
    bugTitle: input.bugTitle,
    reason: input.reason ?? 'No reason given.',
    reporterEmail: input.reporterEmail,
    appName: input.appName,
    orgName: input.orgName,
    pageUrl: input.pageUrl,
    reopenCount: input.reopenCount,
    newStatus: input.newStatus,
  });
}

/**
 * The same, for a reporter status change that is not a reopen.
 *
 * Split from notifyAppOwnerOfReopen rather than branching inside it because the
 * two send genuinely different emails — see the comment on
 * sendReporterStatusChangeNotification. The plumbing either side of the send is
 * identical on purpose: same owner resolution, same early return, same
 * fire-and-forget contract with the caller.
 */
async function notifyAppOwnerOfReporterStatusChange(input: {
  supabase: ReturnType<typeof createAdminClient>;
  applicationId: string;
  bugId: string;
  displayId: string;
  bugTitle: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  reporterEmail: string;
  appName: string;
  orgName: string;
  orgSlug?: string;
  pageUrl: string;
}): Promise<void> {
  const owner = await resolveAppOwnerRecipient(
    input.supabase,
    input.applicationId
  );
  if (!owner) {
    console.warn(
      `[bug-status] No app owner to notify about reporter status change on ${input.displayId}`
    );
    return;
  }

  await EmailService.sendReporterStatusChangeNotification({
    dashboardUrl: buildDashboardUrl(input.orgSlug, input.bugId),
    developerEmail: owner.email,
    developerName: owner.name,
    bugId: input.bugId,
    displayId: input.displayId,
    bugTitle: input.bugTitle,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    // Passed through as-is. Unlike a reopen there is no "No reason given."
    // fallback — the note is optional here, and the template omits the block
    // entirely rather than narrating the absence.
    note: input.note,
    reporterEmail: input.reporterEmail,
    appName: input.appName,
    orgName: input.orgName,
    pageUrl: input.pageUrl,
  });
}

/** Deep link into the dashboard's view of a bug, for the team's own emails. */
function buildDashboardUrl(orgSlug: string | undefined, bugId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || '';
  return orgSlug ? `${base}/org/${orgSlug}/bugs/${bugId}` : `${base}/bugs/${bugId}`;
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
