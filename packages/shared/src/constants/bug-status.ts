/**
 * The single source of truth for bug report status.
 *
 * These five values are the ones the database actually enforces:
 *   bug_reports.status TEXT NOT NULL DEFAULT 'new'
 *     CHECK (status IN ('new','seen','in_progress','resolved','wont_fix'))
 *
 * Before this file existed the vocabulary was declared in six places that
 * disagreed with each other — including a TS union of
 * `open | in_progress | resolved | closed` that the database has never accepted.
 * That mismatch is why BugStatusBadge rendered "Open" for both `new` and
 * `wont_fix`, and why getBugStats always returned zero. Anything that needs to
 * know about status imports from here.
 */

export const BUG_STATUSES = [
  'new',
  'seen',
  'in_progress',
  'resolved',
  'wont_fix',
] as const;

export type BugReportStatus = (typeof BUG_STATUSES)[number];

/** Statuses that close a bug and stamp `resolved_at`. */
export const TERMINAL_BUG_STATUSES: readonly BugReportStatus[] = [
  'resolved',
  'wont_fix',
] as const;

export const BUG_STATUS_LABELS: Record<BugReportStatus, string> = {
  new: 'New',
  seen: 'Seen',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  wont_fix: "Won't Fix",
};

/** Tailwind classes for dashboard + portal badges. */
export const BUG_STATUS_BADGE_CLASS: Record<BugReportStatus, string> = {
  new: 'bg-blue-100 text-blue-800 border-blue-200',
  seen: 'bg-amber-100 text-amber-800 border-amber-200',
  in_progress: 'bg-orange-100 text-orange-800 border-orange-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
  wont_fix: 'bg-gray-100 text-gray-700 border-gray-200',
};

/** Inline hex for HTML email, which cannot use Tailwind. Mirrors the classes above. */
export const BUG_STATUS_EMAIL_COLORS: Record<
  BugReportStatus,
  { bg: string; text: string }
> = {
  new: { bg: '#dbeafe', text: '#1d4ed8' },
  seen: { bg: '#fef3c7', text: '#b45309' },
  in_progress: { bg: '#ffedd5', text: '#c2410c' },
  resolved: { bg: '#dcfce7', text: '#15803d' },
  wont_fix: { bg: '#f3f4f6', text: '#374151' },
};

/**
 * Display order for progress timelines. Note this is presentation only — it is
 * NOT the set of legal transitions (see isValidStatusTransition below).
 */
export const BUG_STATUS_PROGRESSION: readonly BugReportStatus[] = [
  'new',
  'seen',
  'in_progress',
  'resolved',
] as const;

/** Narrows an untrusted string (request body, query param, DB row) to a status. */
export function isBugStatus(value: unknown): value is BugReportStatus {
  return (
    typeof value === 'string' &&
    (BUG_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalBugStatus(status: BugReportStatus): boolean {
  return TERMINAL_BUG_STATUSES.includes(status);
}

export function bugStatusLabel(status: string): string {
  return isBugStatus(status) ? BUG_STATUS_LABELS[status] : status;
}

/**
 * Which status transitions are permitted.
 *
 * Consulted by applyStatusChange() — the single chokepoint through which every
 * status write now passes (dashboard, bulk update, and any future caller). A
 * rejected transition surfaces to the user as a 400, so this map defines what
 * the workflow actually allows.
 *
 * TODO(human): implement the transition rules.
 *
 * Return `true` to permit `from -> to`. Some cases worth deciding deliberately:
 *
 *   - Reopening. Should `resolved -> in_progress` be allowed? Bugs marked fixed
 *     often are not, and reporters will say so in the notes. Blocking it forces
 *     a duplicate bug and loses the history the portal exists to show.
 *   - `wont_fix -> in_progress`. Same question, but this one usually reflects a
 *     genuine change of mind (priorities shifted, a customer escalated).
 *   - Skipping ahead. `new -> resolved` without passing through `seen` /
 *     `in_progress` is common for trivial or already-fixed bugs. Enforcing the
 *     full ladder is tidy but tends to annoy people into working around it.
 *   - Backwards moves like `in_progress -> new`. Rarely meaningful, and usually
 *     a misclick in the inline status dropdown.
 *   - Same-status writes (`from === to`). Cheapest to reject here, which stops a
 *     no-op click from emitting a history event, an email, and a webhook.
 *
 * The permissive answer (allow everything except `from === to`) is a legitimate
 * choice — most trackers do exactly that and rely on the audit trail rather than
 * a state machine. If you want that, the body is a one-liner.
 */
export function isValidStatusTransition(
  from: BugReportStatus,
  to: BugReportStatus
): boolean {
  // Permissive: any real change is allowed, including reopening a resolved or
  // wont_fix bug. Every change is recorded in bug_status_events, so the audit
  // trail — not a state machine — is what keeps the workflow honest.
  //
  // Only a no-op is rejected, so re-selecting the status a bug already has
  // cannot emit a history event, a reporter email, and a webhook for nothing.
  return from !== to;
}
