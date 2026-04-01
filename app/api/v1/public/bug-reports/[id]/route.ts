import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse,
} from '@/lib/middleware/api-key-auth';
import type {
  GetBugReportDetailsResponse,
  UpdateBugReportStatusRequest,
  UpdateBugReportStatusResponse,
  ApiRequestContext,
  BugReport,
  EnhancedBugReportMessage,
  MessageAttachment,
  MessageReaction,
} from '@boobalan_jkkn/shared';
import { EmailService } from '@/lib/services/email/email.service';

interface MessageQueryResult {
  id: string;
  bug_report_id: string;
  sender_user_id: string;
  message_text: string;
  message_type: string;
  created_at: string;
  updated_at: string;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  sender:
    | {
        id: string;
        email: string;
        full_name?: string | null;
        avatar_url?: string | null;
      }
    | {
        id: string;
        email: string;
        full_name?: string | null;
        avatar_url?: string | null;
      }[];
}

/**
 * GET /api/v1/public/bug-reports/:id
 * Get details of a specific bug report
 * Requires API key authentication
 *
 * Query parameters:
 * - include_messages: Include messages (default: true)
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

      // Create Supabase client
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );

      // Fetch bug report
      const { data: bugReport, error: bugError } = await supabase
        .from('bug_reports')
        .select(
          `
          *,
          application:applications(id, name, slug),
          organization:organizations(id, name)
        `
        )
        .eq('id', id)
        .eq('application_id', context.application.id) // Ensure bug belongs to this app
        .single();

      if (bugError) {
        if (bugError.code === 'PGRST116') {
          return createApiErrorResponse(
            'BUG_REPORT_NOT_FOUND',
            'Bug report not found or does not belong to this application',
            404
          );
        }
        console.error('[BugReportAPI /:id] Fetch error:', bugError);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to fetch bug report',
          500,
          { error: bugError.message }
        );
      }

      // Fetch messages if requested
      let messages: EnhancedBugReportMessage[] = [];
      if (includeMessages) {
        const { data: messagesData, error: messagesError } = await supabase
          .from('bug_report_messages')
          .select(
            `
            *,
            sender:profiles(id, email, full_name, avatar_url),
            attachments:bug_report_message_attachments(*),
            reactions:bug_report_message_metadata(*)
          `
          )
          .eq('bug_report_id', id)
          .order('created_at', { ascending: true });

        if (messagesError) {
          console.error('[BugReportAPI /:id] Messages fetch error:', messagesError);
          // Don't fail the request, just log and continue with empty messages
        } else {
          messages = (messagesData as MessageQueryResult[])?.map((msg) => ({
            id: msg.id,
            bug_report_id: msg.bug_report_id,
            sender_user_id: msg.sender_user_id,
            message_text: msg.message_text,
            message_type: msg.message_type,
            created_at: msg.created_at,
            updated_at: msg.updated_at,
            attachments: msg.attachments || [],
            reactions: msg.reactions || [],
            sender: Array.isArray(msg.sender) ? msg.sender[0] : msg.sender,
          })) || [];
        }
      }

      const response: GetBugReportDetailsResponse = {
        bug_report: bugReport as BugReport,
        messages: includeMessages ? messages : undefined,
      };

      console.log('[BugReportAPI /:id] Fetched bug report:', {
        id,
        application: context.application.name,
        messages_count: messages.length,
      });

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
 * Update a bug report's status
 * Requires API key authentication
 *
 * Request body:
 * - status: 'open' | 'in_progress' | 'resolved' | 'closed'
 * - resolution_notes: Optional notes about the resolution
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
      const body = (await request.json()) as UpdateBugReportStatusRequest;

      // Validate status if provided (matches database schema)
      const validStatuses = ['new', 'seen', 'in_progress', 'resolved', 'wont_fix'];
      if (body.status && !validStatuses.includes(body.status)) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          400
        );
      }

      // Create Supabase client
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );

      // First verify the bug report exists and belongs to this application
      const { data: existingBug, error: fetchError } = await supabase
        .from('bug_reports')
        .select('id, status')
        .eq('id', id)
        .eq('application_id', context.application.id)
        .single();

      if (fetchError || !existingBug) {
        return createApiErrorResponse(
          'BUG_REPORT_NOT_FOUND',
          'Bug report not found or does not belong to this application',
          404
        );
      }

      // Build update payload (only columns that exist in bug_reports table)
      const updatePayload: Record<string, any> = {};

      if (body.status) {
        updatePayload.status = body.status;
        // Set resolved_at for resolved/wont_fix status
        if (body.status === 'resolved' || body.status === 'wont_fix') {
          updatePayload.resolved_at = new Date().toISOString();
        }
      }

      // Update the bug report
      const { data: updatedBug, error: updateError } = await supabase
        .from('bug_reports')
        .update(updatePayload)
        .eq('id', id)
        .select(
          `
          *,
          application:applications(id, name, slug),
          organization:organizations(id, name)
        `
        )
        .single();

      if (updateError) {
        console.error('[BugReportAPI /:id PATCH] Update error:', updateError);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to update bug report',
          500,
          { error: updateError.message }
        );
      }

      // If resolution_notes provided, add as a system message
      if (body.resolution_notes) {
        await supabase.from('bug_report_messages').insert({
          bug_report_id: id,
          message_text: `[Status Update] ${body.resolution_notes}`,
          message_type: 'system',
          sender_user_id: null, // System message
        });
      }

      // Notify the reporter if they have an email and status changed (fire-and-forget)
      const reporterEmail = (updatedBug as any).metadata?.reporter_email;
      if (reporterEmail && body.status) {
        EmailService.sendStatusUpdateNotification({
          reporterEmail,
          reporterName: (updatedBug as any).metadata?.reporter_name,
          bugId: updatedBug.id,
          bugTitle: (updatedBug as any).metadata?.title || 'Bug Report',
          newStatus: body.status,
          appName: context.application.name,
          orgName: context.organization.name,
          developerNote: body.resolution_notes,
          bugViewUrl: undefined, // Public API doesn't have a direct reporter view URL
        }).catch(err => console.error('[BugReportAPI PATCH] Email notification failed:', err));
      }

      const response: UpdateBugReportStatusResponse = {
        bug_report: updatedBug as BugReport,
        message: `Bug report status updated to ${body.status || 'unchanged'}`,
      };

      console.log('[BugReportAPI /:id PATCH] Updated bug report:', {
        id,
        application: context.application.name,
        old_status: existingBug.status,
        new_status: body.status,
      });

      return createApiSuccessResponse(response, 200);
    } catch (error) {
      console.error('[BugReportAPI /:id PATCH] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while updating bug report',
        500
      );
    }
  }
);
