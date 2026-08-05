import { NextRequest, NextResponse } from 'next/server';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { applyStatusChange } from '@/lib/services/bug-status/service';
import {
  BUG_STATUSES,
  bugStatusLabel,
  isBugStatus,
  isReopenTransition,
} from '@boobalan_jkkn/shared';

const MAX_NOTE_LENGTH = 5000;

/**
 * POST /api/portal/:appSlug/:bugId/status
 *
 * Lets a reporter move their own report to any of the five statuses, when the
 * application has opted in. Off by default — see getBugPortalConfig.
 *
 * Deliberately NOT a generalisation of /reopen. The two differ in every
 * dimension that matters to a route: which permission gates them, what the body
 * looks like, what the bug's current status has to be, and whether a written
 * reason is required. Folding them together would produce one endpoint whose
 * name lies and whose permission check depends on its own request body. They
 * share the parts worth sharing — the authorization preamble, and
 * applyStatusChange, which owns the history row, the thread message, the webhook
 * and the email for both of them.
 *
 * Authorization is the notes route's, unchanged: re-resolve the same
 * (appSlug, reporter, signature) triple the page itself resolved, then re-prove
 * ownership of this specific bug.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appSlug: string; bugId: string }> }
) {
  try {
    const { appSlug, bugId } = await params;

    let body: {
      status?: string;
      note?: string;
      reporter_email?: string;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const resolved = await resolvePortalRequest(
      appSlug,
      body.reporter_email,
      body.signature
    );

    if (!resolved.ok) {
      const status = resolved.reason === 'not_found' ? 404 : 403;
      return NextResponse.json(
        { message: 'This portal link is not valid.' },
        { status }
      );
    }

    const { application, reporterEmail, config } = resolved;

    if (!config.allowReporterStatus) {
      return NextResponse.json(
        { message: 'Changing the status is turned off for this application.' },
        { status: 403 }
      );
    }

    const toStatus = body.status;
    if (!isBugStatus(toStatus)) {
      return NextResponse.json(
        { message: `Status must be one of: ${BUG_STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    const note = body.note?.trim() || null;
    if (note && note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { message: `Please keep this under ${MAX_NOTE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Ownership of THIS bug, not just of the portal.
    const owned = await getReporterBug(application.id, reporterEmail, bugId);
    if (!owned) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    const fromStatus = owned.bug.status;
    if (!isBugStatus(fromStatus)) {
      return NextResponse.json(
        { message: 'This report has an unrecognised status.' },
        { status: 400 }
      );
    }

    // applyStatusChange rejects the no-op too, but "already Resolved" is a far
    // more useful thing to read than "cannot move a bug from Resolved to
    // Resolved". The control marks the current status unselectable, so reaching
    // this means a stale page or a direct call.
    if (fromStatus === toStatus) {
      return NextResponse.json(
        { message: `This report is already ${bugStatusLabel(toStatus)}.` },
        { status: 400 }
      );
    }

    // The two guards that keep this route from becoming a way around /reopen.
    //
    // A reopen is a reopen whichever control produced it. Without these, turning
    // on "let reporters set the status" would silently re-enable reopening for
    // an app that deliberately turned it off, and would drop the written-reason
    // requirement that reopen_reason and the owner's email both depend on.
    if (isReopenTransition(fromStatus, toStatus)) {
      if (!config.allowReporterReopen) {
        return NextResponse.json(
          { message: 'Reopening is turned off for this application.' },
          { status: 403 }
        );
      }
      if (!note) {
        return NextResponse.json(
          { message: 'Tell the team what is still wrong.' },
          { status: 400 }
        );
      }
    }

    const result = await applyStatusChange({
      bugId,
      toStatus,
      note,
      actor: { kind: 'reporter', email: reporterEmail },
      // The tenant boundary, re-asserted at the write itself.
      applicationId: application.id,
    });

    if (!result.ok) {
      const status =
        result.code === 'NOT_FOUND' ? 404 : result.code === 'DB_ERROR' ? 500 : 400;
      console.error('[portal/status] Status change refused:', result);
      return NextResponse.json({ message: result.message }, { status });
    }

    return NextResponse.json({ success: true, status: toStatus }, { status: 200 });
  } catch (error) {
    console.error('[portal/status] Unexpected error:', error);
    return NextResponse.json(
      { message: 'Something went wrong.' },
      { status: 500 }
    );
  }
}
