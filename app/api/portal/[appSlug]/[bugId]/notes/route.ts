import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { enqueueWebhook } from '@/lib/webhooks/events';

const MAX_MESSAGE_LENGTH = 5000;

/**
 * POST /api/portal/:appSlug/:bugId/notes
 *
 * The portal's own note endpoint. Unlike /api/v1/public/*, this carries no API
 * key — the portal is server-rendered on BugReporter and identifies the caller
 * exactly the way the page itself does, by re-resolving the same
 * (appSlug, reporter, signature) triple. That keeps a single authorization path
 * for both reading and writing, so the two cannot drift apart.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appSlug: string; bugId: string }> }
) {
  try {
    const { appSlug, bugId } = await params;

    let body: { message?: string; reporter_email?: string; signature?: string };
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

    if (!config.allowReporterNotes) {
      return NextResponse.json(
        { message: 'Replies are turned off for this application.' },
        { status: 403 }
      );
    }

    const messageText = body.message?.trim();
    if (!messageText) {
      return NextResponse.json(
        { message: 'Write something first.' },
        { status: 400 }
      );
    }
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { message: `Notes are limited to ${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Re-verify ownership of THIS bug, not just of the portal. Resolving the
    // portal proves who the reporter is; it does not prove the bug is theirs.
    const owned = await getReporterBug(application.id, reporterEmail, bugId);
    if (!owned) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    const supabase = createAdminClient();

    const { data: message, error } = await supabase
      .from('bug_report_messages')
      .insert({
        bug_report_id: bugId,
        sender_user_id: null,
        author_kind: 'reporter',
        author_email: reporterEmail,
        message_text: messageText,
        message_type: 'text',
        is_internal: false,
      })
      .select('id, message_text, author_kind, author_email, created_at')
      .single();

    if (error) {
      console.error('[portal/notes] Insert failed:', error);
      return NextResponse.json(
        { message: 'Could not save your note.' },
        { status: 500 }
      );
    }

    const { data: appRow } = await supabase
      .from('applications')
      .select('settings')
      .eq('id', application.id)
      .maybeSingle();

    await enqueueWebhook(supabase, {
      organizationId: application.organization_id,
      applicationId: application.id,
      bugReportId: bugId,
      settings: appRow?.settings,
      payload: {
        event: 'bug.note_added',
        bug: {
          id: owned.bug.id,
          display_id: owned.bug.display_id,
          reporter_email: reporterEmail,
        },
        note: {
          id: message.id,
          text: message.message_text,
          author_kind: message.author_kind,
          author_email: message.author_email,
        },
        occurred_at: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true, message }, { status: 201 });
  } catch (error) {
    console.error('[portal/notes] Unexpected error:', error);
    return NextResponse.json(
      { message: 'Something went wrong.' },
      { status: 500 }
    );
  }
}
