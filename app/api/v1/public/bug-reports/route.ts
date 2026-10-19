import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse
} from '@/lib/middleware/api-key-auth';
import type {
  SubmitBugReportRequest,
  SubmitBugReportResponse,
  ApiRequestContext,
  Attachment
} from '@boobalan_jkkn/shared';
import { EmailService } from '@/lib/services/email/email.service';
import { resolveAppOwnerRecipient } from '@/lib/services/notifications/app-owner';

// OpenAI embedding model
const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Generate embedding for a bug report (fire-and-forget)
 */
async function generateEmbeddingAsync(
  supabase: SupabaseClient,
  bugId: string,
  title: string,
  description: string
) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        '[BugReportAPI] OPENAI_API_KEY not configured, skipping embedding'
      );
      return;
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const textToEmbed = `${title}\n\n${description}`.trim();
    if (!textToEmbed) {
      console.warn(
        `[BugReportAPI] Bug ${bugId} has no text content, skipping embedding`
      );
      return;
    }

    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: textToEmbed
    });

    const embedding = embeddingResponse.data[0].embedding;

    const { error: updateError } = await supabase
      .from('bug_reports')
      .update({
        embedding: JSON.stringify(embedding),
        embedding_generated_at: new Date().toISOString()
      })
      .eq('id', bugId);

    if (updateError) {
      console.error(
        `[BugReportAPI] Error updating embedding for bug ${bugId}:`,
        updateError
      );
    } else {
      console.log(`[BugReportAPI] Generated embedding for bug ${bugId}`);
    }
  } catch (error) {
    console.error(
      `[BugReportAPI] Error generating embedding for bug ${bugId}:`,
      error
    );
  }
}

/**
 * POST /api/v1/public/bug-reports
 * Submit a bug report via SDK
 * Requires API key authentication
 */
export const POST = withApiKeyAuth(
  async (request: NextRequest, context: ApiRequestContext) => {
    try {
      // Parse request body
      const body: SubmitBugReportRequest = await request.json();

      // Debug: Log incoming attachments
      console.log('[BugReportAPI] Incoming request:', {
        title: body.title,
        hasScreenshot: !!body.screenshot_data_url,
        attachmentsReceived: body.attachments ? body.attachments.length : 0,
        attachmentsData: body.attachments?.map((a) => ({
          filename: a.filename,
          filesize: a.filesize,
          hasDataUrl: !!a.data_url,
          dataUrlLength: a.data_url?.length || 0
        }))
      });

      // Validate required fields
      if (!body.title || !body.description || !body.page_url) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'Missing required fields: title, description, and page_url are required',
          400,
          {
            required_fields: ['title', 'description', 'page_url']
          }
        );
      }

      // Create Supabase client with service role for bypassing RLS
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

      // Handle screenshot upload if provided
      let screenshot_url: string | null = null;
      if (body.screenshot_data_url) {
        try {
          // Extract base64 data
          const matches = body.screenshot_data_url.match(
            /^data:(.+);base64,(.+)$/
          );
          if (matches && matches.length === 3) {
            const contentType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const filename = `bug-screenshot-${Date.now()}-${Math.random()
              .toString(36)
              .substring(7)}.png`;
            const filePath = `${context.organization.id}/${context.application.id}/${filename}`;

            // Upload to Supabase Storage
            const { data: uploadData, error: uploadError } =
              await supabase.storage
                .from('bug-attachments')
                .upload(filePath, buffer, {
                  contentType,
                  cacheControl: '3600'
                });

            if (uploadError) {
              console.error(
                '[BugReportAPI] Screenshot upload error:',
                uploadError
              );
              // Continue without screenshot rather than failing
            } else {
              // Get public URL
              const { data: urlData } = supabase.storage
                .from('bug-attachments')
                .getPublicUrl(filePath);
              screenshot_url = urlData.publicUrl;
            }
          }
        } catch (screenshotError) {
          console.error(
            '[BugReportAPI] Screenshot processing error:',
            screenshotError
          );
          // Continue without screenshot
        }
      }

      // Handle file attachments upload (SDK v1.3.0+)
      const uploadedAttachments: Attachment[] = [];
      if (body.attachments && body.attachments.length > 0) {
        console.log(
          '[BugReportAPI] Processing',
          body.attachments.length,
          'attachments'
        );

        for (const attachment of body.attachments) {
          try {
            // Skip if no data_url (already has URL or invalid)
            if (!attachment.data_url) {
              // If it already has a URL, keep it as-is
              if (attachment.url) {
                uploadedAttachments.push(attachment);
              }
              continue;
            }

            // Extract base64 data from data URL
            const matches = attachment.data_url.match(
              /^data:(.+);base64,(.+)$/
            );
            if (!matches || matches.length !== 3) {
              console.warn(
                '[BugReportAPI] Invalid data_url format for attachment:',
                attachment.filename
              );
              continue;
            }

            const contentType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename with original extension
            const ext = attachment.filename.split('.').pop() || 'bin';
            const uniqueFilename = `attachment-${Date.now()}-${Math.random()
              .toString(36)
              .substring(7)}.${ext}`;
            const filePath = `${context.organization.id}/${context.application.id}/attachments/${uniqueFilename}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from('bug-attachments')
              .upload(filePath, buffer, {
                contentType,
                cacheControl: '3600'
              });

            if (uploadError) {
              console.error(
                '[BugReportAPI] Attachment upload error:',
                uploadError,
                'for file:',
                attachment.filename
              );
              continue;
            }

            // Get public URL
            const { data: urlData } = supabase.storage
              .from('bug-attachments')
              .getPublicUrl(filePath);

            // Create attachment with URL (without data_url to save database space)
            uploadedAttachments.push({
              filename: attachment.filename,
              filetype: attachment.filetype,
              filesize: attachment.filesize,
              url: urlData.publicUrl
            });

            console.log(
              '[BugReportAPI] Uploaded attachment:',
              attachment.filename,
              '->',
              urlData.publicUrl
            );
          } catch (attachmentError) {
            console.error(
              '[BugReportAPI] Error processing attachment:',
              attachment.filename,
              attachmentError
            );
            // Continue with other attachments
          }
        }

        // Summary log for attachments
        console.log('[BugReportAPI] Attachment processing complete:', {
          received: body.attachments?.length || 0,
          uploaded: uploadedAttachments.length,
          uploadedFiles: uploadedAttachments.map((a) => a.filename)
        });
      }

      // Create bug report data matching actual schema
      const bugReportData = {
        organization_id: context.organization.id,
        application_id: context.application.id,
        page_url: body.page_url,
        description: body.description,
        category: body.category || 'bug',
        screenshot_url,
        console_logs: body.console_logs || null,
        attachments:
          uploadedAttachments.length > 0 ? uploadedAttachments : null,
        status: 'new' as const,
        metadata: {
          title: body.title,
          reporter_name: body.reporter_name || null,
          reporter_email: body.reporter_email || null,
          browser_info: body.browser_info || body.metadata?.userAgent || null,
          system_info: body.system_info || null,
          viewport: body.metadata?.viewport || null,
          screen_resolution: body.metadata?.screenResolution || null,
          timestamp: body.metadata?.timestamp || new Date().toISOString(),
          // Network trace captured by SDK v1.2.0+
          network_trace: body.network_trace || null
        }
      };

      const { data: bugReport, error: createError } = await supabase
        .from('bug_reports')
        .insert(bugReportData)
        .select()
        .single();

      if (createError) {
        console.error('[BugReportAPI] Create error:', createError);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to create bug report',
          500,
          { error: createError.message }
        );
      }

      console.log('[BugReportAPI] Bug report created:', {
        id: bugReport.id,
        application: context.application.name,
        organization: context.organization.name,
        attachmentsCount: uploadedAttachments.length
      });

      // Generate embedding asynchronously (fire-and-forget, don't block response)
      generateEmbeddingAsync(
        supabase,
        bugReport.id,
        body.title,
        body.description
      ).catch((err) =>
        console.error('[BugReportAPI] Embedding generation failed:', err)
      );

      // Notify the developer (fire-and-forget)
      (async () => {
        try {
          console.log('[BugReportAPI] Starting developer notification for bug:', bugReport.id);

          // Shared with the reporter-reopen notification, so "who owns this
          // application" is decided in exactly one place.
          const owner = await resolveAppOwnerRecipient(
            supabase,
            context.application.id
          );

          if (!owner) {
            console.warn('[BugReportAPI] No app owner to notify, skipping developer notification');
            return;
          }

          console.log('[BugReportAPI] Sending developer notification to:', owner.email);

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
          const dashboardUrl = context.organization.slug
            ? `${appUrl}/org/${context.organization.slug}/bugs/${bugReport.id}`
            : `${appUrl}/bugs/${bugReport.id}`;

          await EmailService.sendNewBugNotification({
            developerEmail: owner.email,
            developerName: owner.name,
            bugId: bugReport.id,
            bugTitle: body.title,
            bugDescription: body.description,
            reporterName: bugReportData.metadata.reporter_name || undefined,
            reporterEmail: bugReportData.metadata.reporter_email || undefined,
            appName: context.application.name,
            orgName: context.organization.name,
            pageUrl: body.page_url,
            dashboardUrl,
          });
        } catch (err) {
          console.error('[BugReportAPI] Developer email notification failed:', err);
        }
      })();

      const response: SubmitBugReportResponse = {
        bug_report: bugReport,
        message: 'Bug report submitted successfully. Thank you for your report!'
      };

      return createApiSuccessResponse(response, 201);
    } catch (error) {
      console.error('[BugReportAPI] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while processing your request',
        500
      );
    }
  }
);

/**
 * OPTIONS /api/v1/public/bug-reports
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-api-key',
      'Access-Control-Max-Age': '86400'
    }
  });
}

/**
 * GET /api/v1/public/bug-reports
 * Not implemented - use /me endpoint instead
 */
export async function GET() {
  return createApiErrorResponse(
    'INVALID_REQUEST',
    'This endpoint does not support GET requests. Use /api/v1/public/bug-reports/me instead.',
    405
  );
}
