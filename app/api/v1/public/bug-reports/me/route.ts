import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse,
  corsPreflightResponse,
} from '@/lib/middleware/api-key-auth';
import { normalizeReporterEmail } from '@/lib/services/bug-portal/config';
import { BUG_STATUSES } from '@boobalan_jkkn/shared';
import type {
  GetMyBugReportsResponse,
  ApiRequestContext,
  BugReport,
} from '@boobalan_jkkn/shared';

/**
 * GET /api/v1/public/bug-reports/me
 * List the bug reports submitted by ONE reporter of this application.
 * Requires API key authentication.
 *
 * ⚠️ Security note. Despite the "/me" name, this endpoint used to filter only by
 * application_id — so every caller received every bug submitted to the app, with
 * other reporters' names and email addresses included in `metadata`. The API key
 * is shipped to browsers as NEXT_PUBLIC_*, so in practice that exposed the whole
 * app's bug list, and its reporters' contact details, to any of its users.
 *
 * A reporter identity is now REQUIRED. Requests without one are rejected rather
 * than quietly falling back to "everything", because a silent fallback is how
 * the original leak survived unnoticed.
 *
 * Query parameters:
 * - reporter_email: REQUIRED. Scopes results to that reporter.
 * - page, limit (max 100)
 * - status, category, search
 * - sort_by: created_at (default) — see note below
 * - sort_order: asc | desc
 */
export const GET = withApiKeyAuth(async (request: NextRequest, context: ApiRequestContext) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const sortBy = searchParams.get('sort_by') || 'created_at';
    const sortOrder = (searchParams.get('sort_order') || 'desc') as 'asc' | 'desc';

    const reporterEmail = normalizeReporterEmail(
      searchParams.get('reporter_email')
    );

    if (!reporterEmail) {
      return createApiErrorResponse(
        'VALIDATION_ERROR',
        'reporter_email is required. This endpoint returns only the bugs submitted by that reporter.',
        400
      );
    }

    // `updated_at` and `priority` are NOT sortable: neither column exists on
    // bug_reports, so both were guaranteed 500s despite being documented.
    const allowedSortFields = ['created_at', 'resolved_at', 'status'];
    if (!allowedSortFields.includes(sortBy)) {
      return createApiErrorResponse(
        'VALIDATION_ERROR',
        `Invalid sort_by parameter. Allowed values: ${allowedSortFields.join(', ')}`,
        400
      );
    }

    if (status && !(BUG_STATUSES as readonly string[]).includes(status)) {
      return createApiErrorResponse(
        'VALIDATION_ERROR',
        `Invalid status filter. Allowed values: ${BUG_STATUSES.join(', ')}`,
        400
      );
    }

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

    // Scoped by application AND reporter. Both, always — the API key establishes
    // which application, and it cannot establish which person.
    let query = supabase
      .from('bug_reports')
      .select(
        `id, display_id, status, category, description, page_url,
         screenshot_url, attachments, created_at, resolved_at, metadata,
         application:applications(id, name, slug)`,
        { count: 'exact' }
      )
      .eq('application_id', context.application.id)
      .eq('reporter_email', reporterEmail);

    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (search) {
      // `title` lives in the metadata JSONB — there is no title column, so the
      // previous `title.ilike` term made every search request a 500.
      //
      // The sanitiser also strips `"` and `\`: they are PostgREST logic-tree
      // quoting characters, so searching `say "hi"` used to break parsing. `*`
      // is the wildcard inside a logic tree, which avoids depending on how the
      // client library percent-encodes `%`.
      const escaped = search.replace(/["\\%*,()]/g, '').trim();
      if (escaped) {
        query = query.or(
          [
            `description.ilike.*${escaped}*`,
            `display_id.ilike.*${escaped}*`,
            `metadata->>title.ilike.*${escaped}*`,
          ].join(',')
        );
      }
    }

    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    const from = (page - 1) * limit;
    query = query.range(from, from + limit - 1);

    const { data: bugReports, error, count } = await query;

    if (error) {
      console.error('[BugReportAPI /me] Query error:', error);
      return createApiErrorResponse('INTERNAL_ERROR', 'Failed to fetch bug reports', 500, {
        error: error.message,
      });
    }

    const total = count || 0;

    const response: GetMyBugReportsResponse = {
      bug_reports: (bugReports as unknown as BugReport[]) || [],
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };

    console.log('[BugReportAPI /me] Fetched bug reports:', {
      application: context.application.name,
      count: bugReports?.length || 0,
      total,
    });

    return createApiSuccessResponse(response, 200);
  } catch (error) {
    console.error('[BugReportAPI /me] Unexpected error:', error);
    return createApiErrorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while fetching bug reports',
      500
    );
  }
});

export async function OPTIONS() {
  return corsPreflightResponse();
}
