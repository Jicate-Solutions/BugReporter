import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
import type {
  GetBugReportDetailsResponse,
  UpdateBugReportStatusRequest,
  ApiRequestContext,
  BugReport,
} from '@boobalan_jkkn/shared';

const BUG_SELECT = `
  id, display_id, status, category, description, page_url,
  screenshot_url, attachments, console_logs, created_at, resolved_at,
  metadata, application_id, organization_id, reporter_email,
  application:applications(id, name, slug),
  organization:organizations(id, name)
`;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * GET /api/v1/public/bug-reports/:id
 * Details of one bug report, plus its note thread.
 *
 * Requires API key authentication AND a `reporter_email` that matches the bug's
 * reporter. The API key identifies the application, never the person — without
 * the second check any user of an app could read any other user's bug simply by
 * holding its id.
 *
 * Query parameters:
 * - reporter_email: REQUIRED
 * - include_messages: include the thread (default true)
 */
export const GET = withApiKeyAuth(
  async (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const params = await routeContext!.params;
      const { id } = params;
      const { searchParams } = new URL(request.url);
      const includeMessages = searchParams.get('include_messages') !== 'false';
      const reporterEmail = normalizeReporterEmail(
        searchParams.get('reporter_email')
      );

      if (!reporterEmail) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'reporter_email is required.',
          400
        );
      }

      const supabase = serviceClient();

      const { data: bugReport, error: bugError } = await supabase
        .from('bug_reports')
        .select(BUG_SELECT)
        .eq('id', id)
        .eq('application_id', context.application.id)
        .eq('reporter_email', reporterEmail)
        .single();

      if (bugError || !bugReport) {
        if (bugError && bugError.code !== 'PGRST116') {
          console.error('[BugReportAPI /:id] Fetch error:', bugError);
          return createApiErrorResponse(
            'INTERNAL_ERROR',
            'Failed to fetch bug report',
            500,
            { error: bugError.message }
          );
        }
        // Deliberately identical to the wrong-application case: a caller must
        // not be able to tell "exists but isn't yours" from "doesn't exist".
        return createApiErrorResponse(
          'BUG_REPORT_NOT_FOUND',
          'Bug report not found',
          404
        );
      }

      let messages: unknown[] = [];
      if (includeMessages) {
        const { data: messagesData, error: messagesError } = await supabase
          .from('bug_report_messages')
          .select(
            `id, bug_report_id, message_text, message_type, author_kind,
             author_email, created_at, updated_at,
             attachments:bug_report_message_attachments(id, file_url, file_name, file_type)`
          )
          .eq('bug_report_id', id)
          // Internal notes are for the dev team. This is the first place the
          // is_internal column has ever actually been honoured.
          .eq('is_internal', false)
          .eq('is_deleted', false)
          .order('created_at', { ascending: true });

        if (messagesError) {
          console.error('[BugReportAPI /:id] Messages fetch error:', messagesError);
        } else {
          messages = messagesData || [];
        }
      }

      const response = {
        bug_report: bugReport as unknown as BugReport,
        messages: includeMessages ? messages : undefined,
      } as GetBugReportDetailsResponse;

      return createApiSuccessResponse(response, 200);
    } catch (error) {
      console.error('[BugReportAPI /:id] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while fetching bug report',
        500
      );
    }
  }
);

/**
 * PATCH /api/v1/public/bug-reports/:id
 * Add a note to a bug report.
 *
 * Status changes are NOT available to integrated applications — status is owned
 * by the BugReporter dashboard. A request carrying `status` is rejected with a
 * message pointing at the right place, rather than silently ignored.
 *
 * Request body:
 * - resolution_notes: the note to append
 */
export const PATCH = withApiKeyAuth(
  async (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const params = await routeContext!.params;
      const { id } = params;
      const body = (await request.json()) as UpdateBugReportStatusRequest & {
        reporter_email?: string;
      };

      const portal = getBugPortalConfig(context.application.settings);
      if (!portal.enabled) {
        return createApiErrorResponse(
          'FEATURE_NOT_ENABLED',
          'The Bug Status Portal is not enabled for this application. Enable it from the application Settings tab in BugReporter.',
          403
        );
      }
      if (!portal.allowReporterNotes) {
        return createApiErrorResponse(
          'FEATURE_NOT_ENABLED',
          'Reporter notes are disabled for this application.',
          403
        );
      }

      if (body.status) {
        return createApiErrorResponse(
          'FORBIDDEN',
          'Status is managed in the BugReporter dashboard and cannot be changed through the public API. Use this endpoint (or POST /messages) to add a note instead.',
          403
        );
      }

      const note = body.resolution_notes?.trim();
      if (!note) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'resolution_notes is required.',
          400
        );
      }

      const reporterEmail = normalizeReporterEmail(body.reporter_email);
      if (!reporterEmail) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'reporter_email is required.',
          400
        );
      }

      const supabase = serviceClient();

      const { data: bug, error: fetchError } = await supabase
        .from('bug_reports')
        .select('id, organization_id, application_id, display_id, reporter_email')
        .eq('id', id)
        .eq('application_id', context.application.id)
        .eq('reporter_email', reporterEmail)
        .single();

      if (fetchError || !bug) {
        return createApiErrorResponse(
          'BUG_REPORT_NOT_FOUND',
          'Bug report not found',
          404
        );
      }

      // The insert is checked. Previously this wrote sender_user_id: null into a
      // NOT NULL column and never inspected the result, so every note silently
      // failed to save while the caller received a 200.
      const { data: message, error: insertError } = await supabase
        .from('bug_report_messages')
        .insert({
          bug_report_id: id,
          sender_user_id: null,
          author_kind: 'reporter',
          author_email: reporterEmail,
          message_text: note,
          message_type: 'text',
          is_internal: false,
        })
        .select('id, message_text, author_kind, author_email, created_at')
        .single();

      if (insertError) {
        console.error('[BugReportAPI /:id PATCH] Note insert failed:', insertError);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to add note',
          500,
          { error: insertError.message }
        );
      }

      return createApiSuccessResponse(
        { message, success: true },
        201
      );
    } catch (error) {
      console.error('[BugReportAPI /:id PATCH] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while adding the note',
        500
      );
    }
  }
);

export async function OPTIONS() {
  return corsPreflightResponse();
}
