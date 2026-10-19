import { NextRequest } from 'next/server';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse,
  corsPreflightResponse,
} from '@/lib/middleware/api-key-auth';
import {
  getBugPortalConfig,
  normalizeReporterEmail,
} from '@/lib/services/bug-portal/config';
import { getReporterBug } from '@/lib/services/bug-portal/server';
import { applyStatusChange } from '@/lib/services/bug-status/service';
import {
  BUG_STATUSES,
  bugStatusLabel,
  isBugStatus,
  isReopenTransition,
} from '@boobalan_jkkn/shared';
import type { ApiRequestContext } from '@boobalan_jkkn/shared';

const MAX_NOTE_LENGTH = 5000;

/**
 * POST /api/v1/public/bug-reports/:id/status
 *
 * Move one of the caller's own bug reports to another status, from an
 * integrated application rather than from the hosted portal.
 *
 * PATCH on the parent route answers a `status` field with 403 and the message
 * "status is managed in the BugReporter dashboard". That was true when the only
 * other way in was the dashboard; it stopped being true when the portal gained
 * a status control. An application embedding its own "My bug reports" screen
 * was left with no way to offer what the hosted portal offers on the same data
 * — so this exists, and the PATCH refusal now points here.
 *
 * The rules are NOT relaxed for being on the public API. This route enforces
 * exactly what POST /api/portal/:appSlug/:bugId/status enforces, because the two
 * are the same act from different front doors:
 *
 *   - the per-application switches (allow_reporter_status / _close / _reopen)
 *   - ownership of this specific bug by this specific reporter
 *   - a written reason for any reopen
 *   - applyStatusChange, which owns the history row, the thread message, the
 *     owner's email and the webhook
 *
 * What differs is only how the caller is identified. The portal resolves an
 * (appSlug, reporter, signature) triple from a link; here the API key
 * establishes the application and `reporter_email` establishes the person.
 *
 * ⚠️ The API key is shipped to browsers as NEXT_PUBLIC_*, so it proves the
 * application and nothing about who is asking. `reporter_email` is therefore
 * REQUIRED and is matched against the bug's own reporter_email — an integrated
 * app can only move bugs that the named reporter filed. It cannot be omitted to
 * mean "any bug", for the same reason /me rejects a missing reporter: a silent
 * fallback to "everything" is how the original /me leak survived unnoticed.
 *
 * Request body:
 *   status         REQUIRED. One of BUG_STATUSES.
 *   reporter_email REQUIRED. Must own the bug.
 *   note           Optional, except on a reopen where it is required.
 */
export const POST = withApiKeyAuth(
  async (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const params = await routeContext!.params;
      const { id } = params;

      let body: {
        status?: string;
        note?: string;
        reporter_email?: string;
      };
      try {
        body = await request.json();
      } catch {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'Invalid JSON body.',
          400
        );
      }

      const config = getBugPortalConfig(context.application.settings);

      // The portal being off is not the same as a status being disallowed, and
      // saying so saves the integrator guessing at their own settings page.
      if (!config.enabled) {
        return createApiErrorResponse(
          'FEATURE_NOT_ENABLED',
          'The Bug Status Portal is not enabled for this application. Enable it from the application Settings tab in BugReporter.',
          403
        );
      }

      const toStatus = body.status;
      if (!isBugStatus(toStatus)) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          `status must be one of: ${BUG_STATUSES.join(', ')}.`,
          400
        );
      }

      const reporterEmail = normalizeReporterEmail(body.reporter_email);
      if (!reporterEmail) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'reporter_email is required. A status change is only permitted on a bug that reporter filed.',
          400
        );
      }

      // Two different permissions, because they are two different powers.
      // Closing is the reporter's half of the verification handoff and is on by
      // default; setting an arbitrary status is the broad power that lets a
      // reporter declare their own bug done, and is off by default.
      const permitted =
        toStatus === 'closed'
          ? config.allowReporterClose
          : config.allowReporterStatus;

      if (!permitted) {
        return createApiErrorResponse(
          'FEATURE_NOT_ENABLED',
          toStatus === 'closed'
            ? 'Closing reports is turned off for this application.'
            : 'Changing the status is turned off for this application.',
          403
        );
      }

      const note = body.note?.trim() || null;
      if (note && note.length > MAX_NOTE_LENGTH) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          `note must be under ${MAX_NOTE_LENGTH} characters.`,
          400
        );
      }

      // Ownership of THIS bug, by THIS reporter, in THIS application. All three,
      // in one query — the API key established only the last of them.
      const owned = await getReporterBug(
        context.application.id,
        reporterEmail,
        id
      );
      if (!owned) {
        return createApiErrorResponse(
          'NOT_FOUND',
          'Bug report not found.',
          404
        );
      }

      const fromStatus = owned.bug.status;
      if (!isBugStatus(fromStatus)) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'This report has an unrecognised status.',
          400
        );
      }

      // applyStatusChange rejects the no-op too, but "already Resolved" reads
      // far better than "cannot move a bug from Resolved to Resolved".
      if (fromStatus === toStatus) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          `This report is already ${bugStatusLabel(toStatus)}.`,
          400
        );
      }

      // A reopen is a reopen whichever door produced it. Without these, an app
      // that turned reopening off would have it silently re-enabled by turning
      // the broad status power on, and reopen_reason — which the owner's email
      // depends on — would arrive empty.
      if (isReopenTransition(fromStatus, toStatus)) {
        if (!config.allowReporterReopen) {
          return createApiErrorResponse(
            'FEATURE_NOT_ENABLED',
            'Reopening is turned off for this application.',
            403
          );
        }
        if (!note) {
          return createApiErrorResponse(
            'VALIDATION_ERROR',
            'note is required when reopening — tell the team what is still wrong.',
            400
          );
        }
      }

      const result = await applyStatusChange({
        bugId: id,
        toStatus,
        note,
        actor: { kind: 'reporter', email: reporterEmail },
        // The tenant boundary, re-asserted at the write itself.
        applicationId: context.application.id,
      });

      if (!result.ok) {
        const httpStatus =
          result.code === 'NOT_FOUND'
            ? 404
            : result.code === 'FORBIDDEN_ACTOR'
              ? 403
              : result.code === 'DB_ERROR'
                ? 500
                : 400;
        console.error('[BugReportAPI /:id/status] Refused:', result);
        return createApiErrorResponse(
          result.code === 'DB_ERROR' ? 'INTERNAL_ERROR' : result.code,
          result.message,
          httpStatus
        );
      }

      return createApiSuccessResponse(
        {
          id,
          from_status: fromStatus,
          status: toStatus,
          label: bugStatusLabel(toStatus),
        },
        200
      );
    } catch (error) {
      console.error('[BugReportAPI /:id/status] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while updating the status',
        500
      );
    }
  }
);

export async function OPTIONS() {
  return corsPreflightResponse();
}
