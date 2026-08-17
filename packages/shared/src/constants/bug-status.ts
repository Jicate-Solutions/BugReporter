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
  'ready_for_testing',
  'resolved',
  'closed',
  'wont_fix',
] as const;

export type BugReportStatus = (typeof BUG_STATUSES)[number];

/**
 * Statuses that close a bug and stamp `resolved_at`.
 *
 * `ready_for_testing` is deliberately NOT here. The developer has finished, but
 * the bug is not done until the client says so — marking it terminal would stamp
 * a resolution time before anyone verified the fix, drop it out of the team's
 * open queue, and pull the median time-to-fix toward whatever the developer
 * believed rather than what actually held up.
 *
 * `resolved` stays terminal because 399 existing rows carry it and their
 * `resolved_at` is already stamped. It is legacy — see the comment on
 * BUG_STATUS_PROGRESSION.
 */
export const TERMINAL_BUG_STATUSES: readonly BugReportStatus[] = [
  'closed',
  'resolved',
  'wont_fix',
] as const;

/**
 * Who is allowed to move a bug INTO each status.
 *
 * A rule that lives only in the UI is a rule anyone can skip by calling the API.
 * `applyStatusChange` is the single write path, so this map is enforced there
 * for the dashboard, the portal and the public API at once.
 *
 * `ready_for_testing` and `wont_fix` were reporter-blocked when the states were
 * introduced, on the reasoning that they are the team's claims about the work.
 * That was reversed deliberately: on this platform the reporter is the client
 * who commissioned the work, not an anonymous member of the public, and holding
 * back three of the seven states made the portal look broken beside the
 * dashboard. The audit trail, not the vocabulary, is what keeps this honest —
 * bug_status_events records every change with the actor who made it, so a
 * client marking their own bug Won't Fix is visible rather than prevented.
 *
 * `closed` still carries a rule, for the opposite reason: it excludes `api_key`
 * and `system`. Accepting a fix is a judgement a person makes, and an
 * integration closing its own bugs would make "someone agreed this works"
 * unfalsifiable. Both human actors are listed because on an application whose
 * reporters have never opened the portal, a client-only rule would leave every
 * fix parked in `ready_for_testing` forever.
 *
 * Statuses absent from this map are open to anyone.
 */
export const STATUS_ACTOR_RULES: Partial<
  Record<BugReportStatus, readonly ('dashboard_user' | 'reporter' | 'api_key' | 'system')[]>
> = {
  closed: ['reporter', 'dashboard_user'],
};

/**
 * Where a bug lands when its reporter says it is still broken.
 *
 * `seen` is the honest answer. `new` would erase the fact that the team already
 * engaged with this bug once — a reopen is not a fresh report. `in_progress`
 * would claim someone has picked it up, which nobody has yet, and would make the
 * in-progress count unreliable. `seen` says exactly what is true: acknowledged,
 * not closed, not started.
 *
 * Declared here rather than at the call site so the choice sits beside the
 * vocabulary it belongs to — the six-disagreeing-declarations problem this file
 * exists to solve started the same way.
 */
export const REOPEN_TARGET_STATUS: BugReportStatus = 'seen';

export const BUG_STATUS_LABELS: Record<BugReportStatus, string> = {
  new: 'New',
  seen: 'Seen',
  in_progress: 'In Progress',
  // Named for what it asks of the reader, not for what the developer did.
  // "Fixed" would be the team's claim; this is the request that follows it.
  ready_for_testing: 'Ready for Testing',
  resolved: 'Resolved',
  closed: 'Closed',
  wont_fix: "Won't Fix",
};

/** Tailwind classes for dashboard + portal badges. */
export const BUG_STATUS_BADGE_CLASS: Record<BugReportStatus, string> = {
  new: 'bg-blue-100 text-blue-800 border-blue-200',
  seen: 'bg-amber-100 text-amber-800 border-amber-200',
  in_progress: 'bg-orange-100 text-orange-800 border-orange-200',
  // Cyan, because it is the only status that is a question rather than a
  // report — it must not read as either in-progress amber or finished green.
  ready_for_testing: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
  // Deeper than resolved: the client agreed, which is the strongest "done" the
  // system can express.
  closed: 'bg-emerald-200 text-emerald-900 border-emerald-300',
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
  ready_for_testing: { bg: '#cffafe', text: '#155e75' },
  resolved: { bg: '#dcfce7', text: '#15803d' },
  closed: { bg: '#a7f3d0', text: '#064e3b' },
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
  'ready_for_testing',
  'closed',
] as const;

/**
 * Statuses the flow no longer produces, kept because history carries them.
 *
 * `resolved` predates the split between "the developer finished" and "the client
 * agrees". 399 rows hold it with `resolved_at` already stamped, and
 * bug_status_events records transitions into it that must stay readable. It is
 * still a valid, still terminal status; nothing new should be moved into it.
 *
 * Anything offering the reader a choice of status should hide these, which is
 * what separates them from BUG_STATUSES — and anything DISPLAYING a status must
 * still handle them, which is why they stay in it.
 */
export const LEGACY_BUG_STATUSES: readonly BugReportStatus[] = [
  'resolved',
] as const;

/** The statuses a control should offer today. */
export const SELECTABLE_BUG_STATUSES: readonly BugReportStatus[] =
  BUG_STATUSES.filter((s) => !LEGACY_BUG_STATUSES.includes(s));

/**
 * What a picker should offer, given the status the bug already holds.
 *
 * SELECTABLE_BUG_STATUSES alone is not enough for a control that also DISPLAYS
 * the current value. Drop `resolved` from the options of a bug that is sitting
 * in `resolved` and the control has nothing matching its own value to render —
 * a Radix Select falls through to the placeholder and the row goes blank, which
 * is worse than offering the legacy status was.
 *
 * So the current status is always offered, even when legacy. It is never a new
 * choice: re-selecting the status a bug already has is rejected by
 * isValidStatusTransition, and callers disable that row anyway. Order follows
 * BUG_STATUSES so `resolved` stays where the reader expects it rather than
 * being appended after Won't Fix.
 */
export function offerableBugStatuses(
  current: BugReportStatus
): readonly BugReportStatus[] {
  if (!LEGACY_BUG_STATUSES.includes(current)) return SELECTABLE_BUG_STATUSES;
  return BUG_STATUSES.filter(
    (s) => s === current || !LEGACY_BUG_STATUSES.includes(s)
  );
}

/**
 * Closing used to require the bug to be in `ready_for_testing` (later also
 * `resolved`), so that "I tested it and it works" always referred to a fix
 * somebody had actually made.
 *
 * That gate is gone. It removed Closed from the menu on most bugs, which read
 * as the option being broken rather than as a rule, and the two states it did
 * allow were not discoverable — a reporter had no way to know that closing
 * would become available later. Whether a close was earned is now a question
 * for bug_status_events, which records the state each one came from, rather
 * than something the workflow refuses outright.
 */

/**
 * Whether `actor` may move a bug into `status`. See STATUS_ACTOR_RULES.
 */
export function canActorSetStatus(
  actorKind: 'dashboard_user' | 'reporter' | 'api_key' | 'system',
  status: BugReportStatus
): boolean {
  const allowed = STATUS_ACTOR_RULES[status];
  return allowed ? allowed.includes(actorKind) : true;
}

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

/**
 * Whether a status change is a reopen: leaving a closed status for an open one.
 *
 * The single definition of that question. Three places need to agree on it and
 * they are not near each other — applyStatusChange stamps `reopened_at` and
 * bumps `reopen_count`, the portal's status route requires a written reason and
 * checks the reopen permission, and the portal's status control decides whether
 * its note field is optional. If any of them disagreed, a reporter could reopen
 * a bug through a door that does not record why.
 *
 * Note this is about the transition, not the actor. A developer changing their
 * mind and a reporter saying "still broken" are the same event to this function,
 * which is what lets the callers treat them identically.
 */
export function isReopenTransition(
  from: BugReportStatus,
  to: BugReportStatus
): boolean {
  return isTerminalBugStatus(from) && !isTerminalBugStatus(to);
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
