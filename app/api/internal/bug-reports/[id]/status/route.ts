import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { applyStatusChange } from '@/lib/services/bug-status/service';
import { BUG_STATUSES } from '@boobalan_jkkn/shared';

/**
 * PATCH /api/internal/bug-reports/:id/status
 * Updates bug report status.
 *
 * Body: { status: string; resolution_notes?: string }
 * Auth: Supabase session cookie (user must be logged in)
 *
 * The actual write lives in applyStatusChange(), which is the only path allowed
 * to touch bug_reports.status. This route is now just authentication plus a
 * mapping from its result codes to HTTP. Notably, `resolution_notes` is finally
 * persisted — it used to be accepted here and then forwarded only to the email,
 * so the note vanished the moment the message was sent.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let body: { status?: string; resolution_notes?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const { status, resolution_notes } = body;
    if (!status) {
      return NextResponse.json(
        { message: `Status is required. One of: ${BUG_STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    // Session gate. RLS still applies to everything this user can see; the
    // status write itself runs with the service role inside applyStatusChange,
    // which is why the membership check below is not optional.
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
    }

    // Confirm this user can actually see the bug under RLS before handing off to
    // the service-role writer. Without this, any authenticated user on the
    // platform could change the status of any bug in any organization.
    const { data: visible, error: visibilityError } = await supabase
      .from('bug_reports')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (visibilityError) {
      console.error('[InternalStatusAPI] Visibility check failed:', visibilityError);
      return NextResponse.json(
        { message: 'Failed to update bug status.' },
        { status: 500 }
      );
    }
    if (!visible) {
      return NextResponse.json({ message: 'Bug report not found.' }, { status: 404 });
    }

    const result = await applyStatusChange({
      bugId: id,
      toStatus: status,
      note: resolution_notes,
      actor: {
        kind: 'dashboard_user',
        userId: user.id,
        label: user.email ?? null,
      },
    });

    if (!result.ok) {
      const httpStatus =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'DB_ERROR'
            ? 500
            : 400;
      return NextResponse.json({ message: result.message }, { status: httpStatus });
    }

    return NextResponse.json({ success: true, bug: result.bug });
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
