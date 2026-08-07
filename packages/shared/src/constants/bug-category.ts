/**
 * The single source of truth for what a reporter filed a bug as.
 *
 * These are the values the capture widget sends and the only ones that have
 * ever appeared in `bug_reports.category`. Across 701 rows: bug 572, other 47,
 * ui_design 34, feature_request 30, performance 12, security 6.
 *
 * This module exists for the same reason `bug-status.ts` does, and was written
 * after the same bug bit twice. The type here previously read
 * `'ui' | 'functionality' | 'performance' | 'security' | 'other'` — a vocabulary
 * the database has never held. Two of those values cannot occur, and the three
 * that account for 91% of the table were missing from the union entirely, so
 * `getBugStats` reported `ui: 0, functionality: 0` forever while ignoring 636
 * reports.
 *
 * The widget is the only writer of this column and it is a published package,
 * so the vocabulary is fixed by what is already installed in eight applications.
 * Anything that needs to know about category imports from here.
 */

export const BUG_REPORT_CATEGORIES = [
  'bug',
  'feature_request',
  'ui_design',
  'performance',
  'security',
  'other',
] as const;

export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export function isBugReportCategory(
  value: unknown
): value is BugReportCategory {
  return (
    typeof value === 'string' &&
    (BUG_REPORT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** What each category is called in the interface. */
export const BUG_REPORT_CATEGORY_LABELS: Record<BugReportCategory, string> = {
  bug: 'Bug/Issue',
  feature_request: 'New Feature',
  ui_design: 'UI/Design',
  performance: 'Performance',
  security: 'Security',
  other: 'Other',
};
