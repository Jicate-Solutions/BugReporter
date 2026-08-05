import { BUG_STATUS_LABELS, isBugStatus, type BugReportStatus } from '@boobalan_jkkn/shared';

/**
 * The only saturated colour in the portal.
 *
 * Everything else on the page is a warm neutral, which is what lets these read
 * from across a list without being loud — status is the one thing a reporter
 * scans for, so it is the one thing given a hue.
 *
 * These tints are the portal's own, deliberately not the dashboard's
 * BUG_STATUS_BADGE_CLASS. The dashboard's are Tailwind's stock 100/800 pairs,
 * which sit at a saturation that fights this palette. The vocabulary is shared
 * — a reporter and a developer read the same words for the same state — but the
 * surface each is drawn on is not the same surface.
 */
const CHIP: Record<BugReportStatus, { bg: string; fg: string }> = {
  new: { bg: '#eef2ff', fg: '#3b46a8' },
  seen: { bg: '#f3f0ff', fg: '#5b46a8' },
  in_progress: { bg: '#fff4e5', fg: '#8a5a12' },
  resolved: { bg: '#e9f7ee', fg: '#1f6b3d' },
  wont_fix: { bg: '#f2f2f0', fg: '#6b6f76' },
};

const UNKNOWN_CHIP = { bg: '#f2f2f0', fg: '#6b6f76' };

/**
 * The chip colours for a status, for anything that needs to look like a badge
 * without being one.
 *
 * PortalStatusControl renders the same chip as a button, and it has to be
 * indistinguishable from this at rest — a reporter should not be able to tell
 * which of their reports is editable by looking at two different-coloured
 * chips.
 */
export function portalStatusChip(status: string): { bg: string; fg: string } {
  return isBugStatus(status) ? CHIP[status] : UNKNOWN_CHIP;
}

export function PortalStatusBadge({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const chip = portalStatusChip(status);
  const label = isBugStatus(status) ? BUG_STATUS_LABELS[status] : status;

  return (
    <span
      className={`inline-block shrink-0 rounded-md px-[9px] py-[3px] text-[12px] font-semibold ${className}`}
      style={{ background: chip.bg, color: chip.fg }}
    >
      {label}
    </span>
  );
}
