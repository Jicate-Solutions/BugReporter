import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { uploadAttachment } from '@/lib/storage/attachments';
import { enqueueWebhook } from '@/lib/webhooks/events';

const MAX_NOTE_LENGTH = 5000;

/** Mirrors the ladder in the annotator's exportDataUrl. */
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'];

/**
 * POST /api/portal/:appSlug/:bugId/annotation
 *
 * A screenshot the reporter has drawn on, coming back as a note.
 *
 * Authorization is the notes route's, line for line — the same
 * (appSlug, reporter, signature) triple re-resolved server-side, then a second
 * check that this particular bug belongs to that reporter. The two endpoints
 * must not drift: this one accepts a file, which makes it the more attractive of
 * the pair to get wrong.
 *
 * The marks are already flattened into the image by the time it arrives. There
 * is no annotation layer stored anywhere — what the reporter drew on is the file
 * the dev team opens.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appSlug: string; bugId: string }> }
) {
  try {
    const { appSlug, bugId } = await params;

    let body: {
      image_data_url?: string;
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

    const { application, reporterEmail, canAnnotate } = resolved;

    // One flag, resolved once. `canAnnotate` already folds in the reply
    // permission, because the marked-up image is posted to the thread and with
    // replies off there would be nowhere for it to land.
    if (!canAnnotate) {
      return NextResponse.json(
        { message: 'Marking up screenshots is turned off for this application.' },
        { status: 403 }
      );
    }

    const dataUrl = body.image_data_url;
    const match = dataUrl?.match(/^data:([a-z]+\/[a-z+.-]+);base64,(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { message: 'That image did not come through.' },
        { status: 400 }
      );
    }

    const filetype = match[1].toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(filetype)) {
      return NextResponse.json(
        { message: 'Only PNG and JPEG images can be attached.' },
        { status: 400 }
      );
    }

    const note = body.note?.trim() ?? '';
    if (note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { message: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Re-verify ownership of THIS bug, not just of the portal. Resolving the
    // portal proves who the reporter is; it does not prove the bug is theirs.
    const owned = await getReporterBug(application.id, reporterEmail, bugId);
    if (!owned) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    // base64 is 4 characters per 3 bytes, minus whatever padding is on the end.
    const filesize = Math.floor((match[2].length * 3) / 4);
    const extension = filetype === 'image/png' ? 'png' : 'jpg';

    const upload = await uploadAttachment({
      applicationSlug: application.slug,
      bugReportId: bugId,
      file: {
        filename: `marked-up-screenshot.${extension}`,
        filesize,
        filetype,
        data_url: dataUrl as string,
      },
    });

    if (!upload.success || !upload.attachment) {
      console.error('[portal/annotation] Upload failed:', upload.error);
      return NextResponse.json(
        {
          message:
            upload.error ?? 'Could not save your image. Try marking up less of it.',
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: message, error } = await supabase
      .from('bug_report_messages')
      .insert({
        bug_report_id: bugId,
        sender_user_id: null,
        author_kind: 'reporter',
        author_email: reporterEmail,
        // The image is the point, but a thread entry with no words reads as an
        // empty message in every list that renders text before attachments.
        message_text: note || 'Marked up the screenshot.',
        message_type: 'annotation',
        attachment_url: upload.attachment.url,
        attachment_type: upload.attachment.filetype,
        is_internal: false,
      })
      .select(
        'id, message_text, author_kind, author_email, created_at, attachment_url, attachment_type'
      )
      .single();

    if (error) {
      console.error('[portal/annotation] Insert failed:', error);
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

    // The existing note event, not a new one. An annotation IS a note that
    // happens to carry a picture, and minting `bug.annotation_added` would mean
    // every consumer had to subscribe to a second event to keep seeing these.
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
          attachment_url: message.attachment_url,
        },
        occurred_at: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true, message }, { status: 201 });
  } catch (error) {
    console.error('[portal/annotation] Unexpected error:', error);
    return NextResponse.json(
      { message: 'Something went wrong.' },
      { status: 500 }
    );
  }
}
