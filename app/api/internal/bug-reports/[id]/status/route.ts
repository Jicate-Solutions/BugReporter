import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EmailService } from '@/lib/services/email/email.service';

const VALID_STATUSES = ['new', 'seen', 'in_progress', 'resolved', 'wont_fix'];

/**
 * PATCH /api/internal/bug-reports/:id/status
 * Updates bug report status and fires an email notification to the reporter.
 *
 * Body: { status: string; resolution_notes?: string }
 * Auth: Supabase session cookie (user must be logged in)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Parse request body
    let body: { status?: string; resolution_notes?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const { status, resolution_notes } = body;

    // Validate status
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    // Create authenticated Supabase client
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
    }

    // Fetch the bug report with metadata, application, and organization info
    const { data: bug, error: fetchError } = await supabase
      .from('bug_reports')
      .select('*, application:applications(id, name, slug), organization:organizations(id, name)')
      .eq('id', id)
      .single();

    if (fetchError || !bug) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    // Build update payload — set resolved_at for terminal statuses
    const updatePayload: { status: string; resolved_at: string | null } = {
      status,
      resolved_at: null,
    };
    if (status === 'resolved' || status === 'wont_fix') {
      updatePayload.resolved_at = new Date().toISOString();
    }

    // Update the bug status in the database
    const { data: updatedBug, error: updateError } = await supabase
      .from('bug_reports')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[InternalStatusAPI] DB update error:', updateError);
      return NextResponse.json(
        { message: updateError.message || 'Failed to update bug status.' },
        { status: 500 }
      );
    }

    // Fire-and-forget email notification if reporter email is present
    const reporterEmail = bug?.metadata?.reporter_email;
    if (reporterEmail && status) {
      EmailService.sendStatusUpdateNotification({
        reporterEmail,
        reporterName: bug?.metadata?.reporter_name,
        bugId: id,
        bugTitle: bug?.metadata?.title || 'Bug Report',
        newStatus: status,
        appName: bug?.application?.name || 'App',
        orgName: bug?.organization?.name || 'Organization',
        developerNote: resolution_notes,
        bugViewUrl: undefined,
      }).catch(err => console.error('[InternalStatusAPI] Email failed:', err));
    }

    return NextResponse.json({ success: true, bug: updatedBug });
  } catch (error) {
    console.error('[InternalStatusAPI] Unexpected error:', error);
    return NextResponse.json(
      {
        message: 'Internal server error.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
