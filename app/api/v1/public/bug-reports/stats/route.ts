import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  withApiKeyAuth,
  createApiErrorResponse,
  createApiSuccessResponse,
  corsPreflightResponse,
} from '@/lib/middleware/api-key-auth';
import { normalizeReporterEmail } from '@/lib/services/bug-portal/config';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  isBugStatus,
  isTerminalBugStatus,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import type { ApiRequestContext } from '@boobalan_jkkn/shared';

/** Rows read for one reporter. Far above any real reporter's total; a guard, not a page size. */
const MAX_ROWS = 5000;
/** Months of history in `trend`. Six fits a chart without a horizontal scroll. */
const TREND_MONTHS = 6;

interface StatsRow {
  status: string | null;
  category: string | null;
  created_at: string | null;
  resolved_at: string | null;
}

/** YYYY-MM in UTC. Bucketing by local time would move rows between months by timezone. */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Median, not mean, for time-to-fix.
 *
 * One bug that sat open for a year drags an average far past anything a reader
 * would recognise as typical. The portal header already quotes a median for the
 * same reason; this keeps the two answering the same question the same way.
 * `average_days` is returned alongside it so a caller who wants the mean is not
 * forced to re-derive it from the raw list.
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * GET /api/v1/public/bug-reports/stats
 *
 * The aggregate behind a "my bug reports" analytics screen: how many, in what
 * state, in what category, how long they take, and how that moved month to
 * month. Requires API key authentication.
 *
 * Exists because the only aggregate the platform had was the org-wide dashboard
 * rollup, which is behind a login and spans every application. An integrated app
 * building its own screen had to pull every bug through /me and count them in
 * the browser — which means paging through the whole list to render a single
 * number, and re-implementing "which statuses are terminal" on the client, where
 * it will drift.
 *
 * ⚠️ `reporter_email` is REQUIRED, exactly as on /me. The API key is shipped to
 * browsers as NEXT_PUBLIC_*, so it proves the application and nothing about who
 * is asking. Counts across every reporter would let any user of the app measure
 * everyone else's reports; the missing parameter is rejected rather than treated
 * as "all", because a silent fallback to everything is how the original /me leak
 * survived unnoticed.
 *
 * Query parameters:
 *   reporter_email  REQUIRED. Scopes every figure to that reporter.
 *
 * Response:
 *   totals      total / open / done  (done = terminal statuses)
 *   by_status   every status in the vocabulary, INCLUDING zeroes
 *   by_category counts by category, plus `uncategorised`
 *   resolution  counted / median_days / average_days / fastest / slowest
 *   trend       last 6 months, oldest first: { month, reported, completed }
 */
export const GET = withApiKeyAuth(
  async (request: NextRequest, context: ApiRequestContext) => {
    try {
      const { searchParams } = new URL(request.url);

      const reporterEmail = normalizeReporterEmail(
        searchParams.get('reporter_email')
      );

      if (!reporterEmail) {
        return createApiErrorResponse(
          'VALIDATION_ERROR',
          'reporter_email is required. This endpoint reports only on the bugs submitted by that reporter.',
          400
        );
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      // Four columns, not `*`. Everything below is derived from these, and the
      // wide row carries description, metadata and attachment URLs that an
      // aggregate has no business shipping to a browser.
      const { data, error } = await supabase
        .from('bug_reports')
        .select('status, category, created_at, resolved_at')
        .eq('application_id', context.application.id)
        .eq('reporter_email', reporterEmail)
        .limit(MAX_ROWS);

      if (error) {
        console.error('[BugReportAPI /stats] Query error:', error);
        return createApiErrorResponse(
          'INTERNAL_ERROR',
          'Failed to fetch bug report statistics',
          500,
          { error: error.message }
        );
      }

      const rows = (data as StatsRow[]) || [];

      // Seeded with every status at zero. A reader asking "how many of mine are
      // In Progress?" is answered by "0" and not answered at all by a key that
      // is missing — and a caller rendering a chart should not have to know the
      // vocabulary to know which bars to draw.
      const byStatus = Object.fromEntries(
        BUG_STATUSES.map((s) => [s, 0])
      ) as Record<BugReportStatus, number>;

      const byCategory: Record<string, number> = {};
      const resolutionDays: number[] = [];
      const trend = new Map<string, { reported: number; completed: number }>();

      // Seeded forward from TREND_MONTHS ago so a quiet month renders as a gap
      // in the line rather than vanishing and making the axis lie about time.
      const now = new Date();
      for (let i = TREND_MONTHS - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        trend.set(d.toISOString().slice(0, 7), { reported: 0, completed: 0 });
      }

      let open = 0;
      let done = 0;

      for (const row of rows) {
        const status: BugReportStatus = isBugStatus(row.status)
          ? row.status
          : 'new';
        byStatus[status] += 1;

        if (isTerminalBugStatus(status)) done += 1;
        else open += 1;

        const category = row.category?.trim() || 'uncategorised';
        byCategory[category] = (byCategory[category] || 0) + 1;

        if (row.created_at) {
          const bucket = trend.get(monthKey(row.created_at));
          if (bucket) bucket.reported += 1;
        }

        // resolved_at is stamped on entry to a terminal status and never
        // cleared, so a reopened bug keeps its original figure rather than
        // contributing a second, shorter one.
        if (row.created_at && row.resolved_at) {
          const ms =
            new Date(row.resolved_at).getTime() -
            new Date(row.created_at).getTime();
          if (ms >= 0) resolutionDays.push(ms / 86_400_000);

          const bucket = trend.get(monthKey(row.resolved_at));
          if (bucket) bucket.completed += 1;
        }
      }

      const medianDays = median(resolutionDays);

      return createApiSuccessResponse(
        {
          reporter_email: reporterEmail,
          application: {
            id: context.application.id,
            name: context.application.name,
            slug: context.application.slug,
          },
          totals: { total: rows.length, open, done },
          by_status: byStatus,
          // Sent so a caller need not hard-code the vocabulary to render a
          // legend, and cannot drift out of step with it when it changes.
          status_labels: BUG_STATUS_LABELS,
          by_category: byCategory,
          resolution: {
            counted: resolutionDays.length,
            median_days: medianDays === null ? null : round(medianDays),
            average_days:
              resolutionDays.length === 0
                ? null
                : round(
                    resolutionDays.reduce((a, b) => a + b, 0) /
                      resolutionDays.length
                  ),
            fastest_days:
              resolutionDays.length === 0
                ? null
                : round(Math.min(...resolutionDays)),
            slowest_days:
              resolutionDays.length === 0
                ? null
                : round(Math.max(...resolutionDays)),
          },
          trend: [...trend.entries()].map(([month, counts]) => ({
            month,
            ...counts,
          })),
          truncated: rows.length === MAX_ROWS,
        },
        200
      );
    } catch (error) {
      console.error('[BugReportAPI /stats] Unexpected error:', error);
      return createApiErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred while fetching statistics',
        500
      );
    }
  }
);

export async function OPTIONS() {
  return corsPreflightResponse();
}
