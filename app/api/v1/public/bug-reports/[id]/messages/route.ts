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
import {
  enforceRateLimit,
  REPORTER_WRITE_RATE_LIMIT,
} from '@/lib/middleware/rate-limit';
import { enqueueWebhook } from '@/lib/webhooks/events';
import type {
  SendBugReportMessageRequest,
  ApiRequestContext,
} from '@boobalan_jkkn/shared';

const MESSAGE_SELECT = `id, bug_report_id, message_text, message_type,
  author_kind, author_email, created_at, updated_at,
  attachments:bug_report_message_attachments(id, file_url, file_name, file_type)`;

const MAX_MESSAGE_LENGTH = 5000;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Resolve a bug scoped to BOTH the calling application and the given reporter.
 * Returns null when either check fails — the caller must not be able to
 * distinguish "wrong reporter" from "no such bug".
 */
async function findScopedBug(
  supabase: ReturnType<typeof serviceClient>,
  bugId: string,
  applicationId: string,
  reporterEmail: string
) {
  const { data } = await supabase
    .from('bug_reports')
    .select('id, display_id, organization_id, application_id, reporter_email')
    .eq('id', bugId)
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail)
    .single();

  return data ?? null;
}

/**
 * GET /api/v1/public/bug-reports/:id/messages
 * The note thread for one bug, as its reporter sees it.
 *
 * Internal notes are excluded. This endpoint did not previously exist — the
 * thread was only reachable embedded in GET /:id.
 */
export const GET = withApiKeyAuth(
  async (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const { id: bugReportId } = await routeContext!.params;
      const { searchParams } = new URL(request.url);
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
      const bug = await findScopedBug(
        supabase,
        bugReportId,
        context.application.id,
        reporterEmail
      );

      if (!bug) {
        return createApiErrorResponse(
          'BUG_REPORT_NOT_FOUND',
          'Bug report not found',
          404
        );
      }

      const { data: messages, error } = await supabase
        .from('bug_report_messages')
        .select(MESSAGE_SELECT)
        .eq('bug_report_id', bugReportId)
        .eq('is_internal', false)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[BugReportAPI /messages GET] Query error:', error);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to fetch messages',
          500,
          { error: error.message }
        );
      }

      return createApiSuccessResponse({ messages: messages || [] }, 200);
    } catch (error) {
      console.error('[BugReportAPI /messages GET] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while fetching messages',
        500
      );
    }
  }
);

/**
 * POST /api/v1/public/bug-reports/:id/messages
 * Post a note as the bug's reporter.
 *
 * Gated on the application having enabled the Bug Status Portal and left
 * reporter notes on. Requires `reporter_email` matching the bug's reporter, so
 * one user of an app cannot post as another.
 */
export const POST = withApiKeyAuth(
  async (
    request: NextRequest,
    context: ApiRequestContext,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const limited = await enforceRateLimit(
        request,
        context,
        'bug-reports:message',
        REPORTER_WRITE_RATE_LIMIT
      );
      if (limited) return limited;

      const { id: bugReportId } = await routeContext!.params;
      const body = (await request.json()) as SendBugReportMessageRequest & {
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

      const messageText = body.message?.trim();
      if (!messageText) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'Message text is required and cannot be empty',
          400
        );
      }
      if (messageText.length > MAX_MESSAGE_LENGTH) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
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
      const bug = await findScopedBug(
        supabase,
        bugReportId,
        context.application.id,
        reporterEmail
      );

      if (!bug) {
        return createApiErrorResponse(
          'BUG_REPORT_NOT_FOUND',
          'Bug report not found',
          404
        );
      }

      const { data: created, error: createError } = await supabase
        .from('bug_report_messages')
        .insert({
          bug_report_id: bugReportId,
          sender_user_id: null,
          author_kind: 'reporter',
          author_email: reporterEmail,
          message_text: messageText,
          message_type: 'text',
          is_internal: false,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[BugReportAPI /messages] Create message error:', createError);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to send message',
          500,
          { error: createError.message }
        );
      }

      // Attachments live in their own table, alongside the ones the in-app
      // messaging UI writes. Inserted after the message so a bad attachment
      // cannot cost the reporter the note they just typed.
      if (Array.isArray(body.attachments) && body.attachments.length) {
        const rows = body.attachments
          .filter((url): url is string => typeof url === 'string' && !!url.trim())
          .slice(0, 10)
          .map((url) => ({
            message_id: created.id,
            file_url: url,
            // file_name is NOT NULL, so it always needs a value.
            file_name: url.split('/').pop() || 'attachment',
          }));

        if (rows.length) {
          const { error: attachmentError } = await supabase
            .from('bug_report_message_attachments')
            .insert(rows);
          if (attachmentError) {
            console.error(
              '[BugReportAPI /messages] Attachment insert failed:',
              attachmentError
            );
          }
        }
      }

      const { data: message } = await supabase
        .from('bug_report_messages')
        .select(MESSAGE_SELECT)
        .eq('id', created.id)
        .single();

      await enqueueWebhook(supabase, {
        organizationId: bug.organization_id,
        applicationId: bug.application_id,
        bugReportId,
        settings: context.application.settings,
        payload: {
          event: 'bug.note_added',
          bug: {
            id: bug.id,
            display_id: bug.display_id,
            reporter_email: bug.reporter_email ?? null,
          },
          note: {
            id: created.id,
            text: messageText,
            author_kind: 'reporter',
            author_email: reporterEmail,
          },
          occurred_at: new Date().toISOString(),
        },
      });

      return createApiSuccessResponse({ message, success: true }, 201);
    } catch (error) {
      console.error('[BugReportAPI /messages] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while sending message',
        500
      );
    }
  }
);

export async function OPTIONS() {
  return corsPreflightResponse();
}
