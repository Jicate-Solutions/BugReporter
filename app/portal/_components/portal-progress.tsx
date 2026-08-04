import { TERMINAL_BUG_STATUSES } from '@boobalan_jkkn/shared';

interface PortalProgressProps {
  total: number;
  byStatus: Record<string, number>;
}

/**
 * A one-line answer to the question that brings a reporter here: is anything
 * happening to the things I reported?
 *
 * The flat list could not say. It showed 27 rows in the same weight whether
 * they had been fixed or ignored for a fortnight. This states the ratio plainly
 * — including when the ratio is unflattering, which is the point: the reporter
 * is entitled to know, and a portal that only ever looks reassuring is not
 * worth checking.
 */
export function PortalProgress({ total, byStatus }: PortalProgressProps) {
  if (total === 0) return null;

  const closed = TERMINAL_BUG_STATUSES.reduce(
    (sum, status) => sum + (byStatus[status] ?? 0),
    0
  );
  const open = total - closed;
  const percent = Math.round((closed / total) * 100);

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="text-sm">
          <span className="font-medium tabular-nums">{closed}</span>
          <span className="text-muted-foreground"> of </span>
          <span className="font-medium tabular-nums">{total}</span>
          <span className="text-muted-foreground"> closed</span>
        </p>
        {open > 0 && (
          <p className="text-muted-foreground text-sm tabular-nums">
            {open} still open
          </p>
        )}
      </div>

      <div
        className="bg-muted h-1 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${closed} of ${total} reports closed`}
      >
        <div
          className="bg-emerald-500 h-full rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
