import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import type { ReporterStats } from '@/lib/services/bug-portal/server';
import type { RailSegment } from './portal-shell';

/**
 * The reporter's reports, as proportions for the header's status rule.
 *
 * Zero-count statuses get no segment, so a reporter whose reports have all been
 * fixed sees one unbroken green rule rather than a mostly-empty track — and a
 * page where nothing has been looked at cannot be made to look busy.
 */
export function buildRail(stats: ReporterStats): RailSegment[] {
  return BUG_STATUSES.map((status: BugReportStatus) => ({
    status,
    value: stats.byStatus[status] ?? 0,
  })).filter((s: RailSegment) => s.value > 0);
}

/**
 * What a screen reader hears in place of the rule.
 *
 * This carries the counts that the deleted legend used to show. The status pills
 * below say the same thing in text, so this is belt and braces rather than the
 * only copy — but the rule is the thing pinned to the top of the page, and it
 * should be able to answer the question on its own.
 */
export function railLabel(segments: RailSegment[]): string {
  if (segments.length === 0) return 'No reports yet';
  return `Your reports: ${segments
    .map((s) => `${BUG_STATUS_LABELS[s.status]} ${s.value}`)
    .join(', ')}`;
}

/**
 * "typically 8.9 days to fix", or nothing at all.
 *
 * Returns null rather than a placeholder when no report has closed yet. A header
 * that says "typically — to fix" is worse than a header that says one thing
 * less.
 */
export function medianNote(stats: ReporterStats): string | null {
  if (stats.medianCloseDays === null) return null;
  return `typically ${formatMedian(stats.medianCloseDays)} to fix`;
}

/**
 * Days are the wrong unit below one. A team that closes reports in twenty-two
 * hours has earned a number that says so, and "0.9d" reads like a rounding
 * error rather than an achievement.
 */
export function formatMedian(days: number | null): string {
  if (days === null) return '—';
  if (days < 1 / 24) return 'under an hour';
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days < 10) return `${days.toFixed(1).replace(/\.0$/, '')} days`;
  return `${Math.round(days)} days`;
}
