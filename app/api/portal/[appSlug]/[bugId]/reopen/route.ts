import { NextRequest, NextResponse } from 'next/server';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { applyStatusChange } from '@/lib/services/bug-status/service';
import {
  REOPEN_TARGET_STATUS,
  isBugStatus,
  isTerminalBugStatus,
} from '@boobalan_jkkn/shared';

const MAX_REASON_LENGTH = 5000;

/**
 * POST /api/portal/:appSlug/:bugId/reopen
 *
 * The reporter's right of reply to "we fixed it". Moves a closed bug back to
 * `seen` and records who said so and why.
 *
 * Authorization is the notes route's, deliberately unchanged: re-resolve the
 * same (appSlug, reporter, signature) triple the page itself resolved, then
 * re-prove ownership of this specific bug. Resolving the portal establishes who
 * the caller is; it says nothing about whether this bug is theirs.
 *
 * The actual write goes through applyStatusChange() rather than touching
 * bug_reports directly, so the history row, the visible note, the webhook and
 * the team email cannot be forgotten here — they are that function's job, not
 * this route's.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appSlug: string; bugId: string }> }
) {
  try {
    const { appSlug, bugId } = await params;

    let body: { reason?: string; reporter_email?: string; signature?: string };
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

    if (!config.allowReporterReopen) {
      return NextResponse.json(
        { message: 'Reopening is turned off for this application.' },
        { status: 403 }
      );
    }

    const reason = body.reason?.trim();
    if (!reason) {
      return NextResponse.json(
        { message: 'Tell the team what is still wrong.' },
        { status: 400 }
      );
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        { message: `Please keep this under ${MAX_REASON_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Ownership of THIS bug, not just of the portal.
    const owned = await getReporterBug(application.id, reporterEmail, bugId);
    if (!owned) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    // Only a closed bug can be reopened. applyStatusChange would reject the
    // no-op case anyway, but "this report is already open" is a far more useful
    // thing to read than a generic transition error.
    const current = owned.bug.status;
    if (!isBugStatus(current) || !isTerminalBugStatus(current)) {
      return NextResponse.json(
        { message: 'This report is already open — add a note instead.' },
        { status: 400 }
      );
    }

    const result = await applyStatusChange({
      bugId,
      toStatus: REOPEN_TARGET_STATUS,
      note: reason,
      actor: { kind: 'reporter', email: reporterEmail },
      // The tenant boundary, re-asserted at the write itself.
      applicationId: application.id,
    });

    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 400;
      console.error('[portal/reopen] Status change refused:', result);
      return NextResponse.json({ message: result.message }, { status });
    }

    return NextResponse.json(
      { success: true, status: REOPEN_TARGET_STATUS },
      { status: 200 }
    );
  } catch (error) {
    console.error('[portal/reopen] Unexpected error:', error);
    return NextResponse.json(
      { message: 'Something went wrong.' },
      { status: 500 }
    );
  }
}
