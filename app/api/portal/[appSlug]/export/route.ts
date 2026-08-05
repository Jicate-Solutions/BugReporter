import { NextRequest, NextResponse } from 'next/server';
import {
  resolvePortalRequest,
  listReporterBugs,
  PORTAL_BUG_LIMIT,
} from '@/lib/services/bug-portal/server';
import { bugStatusLabel } from '@boobalan_jkkn/shared';

/**
 * GET /api/portal/:appSlug/export?u=…&sig=…
 *
 * The reporter's own reports as CSV, so they can take them into a meeting or a
 * spreadsheet without copying rows by hand.
 *
 * Authorization is the portal's, unchanged: the same (appSlug, reporter,
 * signature) triple the page itself resolves. This is a GET that produces a file
 * rather than a page, which is the only difference.
 *
 * Scope is deliberately *everything the reporter has*, not the current filtered
 * view. An export is something people file away and come back to, and one that
 * silently contained ten of twenty-seven rows because a filter was active when
 * they clicked would be worse than no export at all.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appSlug: string }> }
) {
  try {
    const { appSlug } = await params;
    const { searchParams } = new URL(request.url);

    const resolved = await resolvePortalRequest(
      appSlug,
      searchParams.get('u') ?? undefined,
      searchParams.get('sig') ?? undefined
    );

    if (!resolved.ok) {
      const status = resolved.reason === 'not_found' ? 404 : 403;
      return NextResponse.json(
        { message: 'This portal link is not valid.' },
        { status }
      );
    }

    const { application, reporterEmail } = resolved;

    // One page large enough to hold everything this reporter has. The service
    // caps at PORTAL_BUG_LIMIT regardless, so this cannot run away.
    const result = await listReporterBugs(application.id, reporterEmail, {
      page: 1,
      pageSize: PORTAL_BUG_LIMIT,
    });

    const header = [
      'Report ID',
      'Title',
      'Description',
      'Status',
      'Where',
      'Reported',
      'Last activity',
      'Notes',
      'Times reopened',
      'Page URL',
    ];

    const rows = result.bugs.map((bug) => [
      bug.display_id,
      bug.title,
      bug.description,
      bugStatusLabel(bug.status),
      bug.area ?? '',
      formatDate(bug.created_at),
      formatDate(bug.lastActivityAt),
      String(bug.noteCount),
      String(bug.reopenCount),
      bug.page_url ?? '',
    ]);

    const csv = [header, ...rows].map(toCsvRow).join('\r\n');
    const filename = `${application.slug}-bug-reports-${today()}.csv`;

    return new NextResponse(
      // A BOM so Excel opens UTF-8 correctly. Without it, any non-ASCII
      // character in a title arrives as mojibake, which is exactly the kind of
      // detail that makes an export look broken.
      '﻿' + csv,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[portal/export] Unexpected error:', error);
    return NextResponse.json(
      { message: 'Could not build the export.' },
      { status: 500 }
    );
  }
}

/**
 * Quote every field rather than only the ones that need it.
 *
 * The leading apostrophe guards against CSV injection: a title beginning with
 * =, +, - or @ is executed as a formula when the file is opened in Excel or
 * Sheets, and bug titles are attacker-influenced text written by whoever used
 * the widget. Prefixing makes the cell inert while leaving it readable.
 */
function toCsvRow(fields: string[]): string {
  return fields
    .map((field) => {
      const value = (field ?? '').replace(/\r?\n/g, ' ').trim();
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    })
    .join(',');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
