import type { ReporterStats } from '@/lib/services/bug-portal/server';
import { BUG_STATUSES, BUG_STATUS_LABELS, type BugReportStatus } from '@boobalan_jkkn/shared';

/**
 * What happened to your reports, as a proportion.
 *
 * This replaces four equal stat tiles. Tiles were the wrong shape for the
 * question: they gave the same weight to every figure, which meant a card was
 * permanently reserved for "In progress 0" — the page's most prominent element
 * saying nothing.
 *
 * The bar is the honest part: segments are sized by real counts, so a page where
 * nothing has been looked at cannot be made to look busy. Zero-count statuses
 * simply have no segment and no legend entry, which is how "nothing is in
 * progress" stops needing a box of its own.
 *
 * There was also a sentence over the bar spelling the same counts out in prose
 * ("Five of your 28 reports are fixed…"). It is gone: the bar and its legend
 * already carry every figure it named, and a headline that restates the graphic
 * beneath it is the largest thing on the page saying nothing new.
 *
 * Every figure counts this reporter's own reports and says what it counts. The
 * mock these came from carried "last 30 days" under Resolved and an invented
 * median; both are windows we do not compute, so nothing here claims them. A
 * dashboard that rounds toward flattering is a dashboard nobody checks twice.
 */
export function PortalStats({ stats }: { stats: ReporterStats }) {
  if (stats.total === 0) return null;

  const count = (status: string) => stats.byStatus[status] ?? 0;

  const wontFix = count('wont_fix');

  const segments = BUG_STATUSES.map((status: BugReportStatus) => ({
    status,
    value: count(status),
  })).filter((s: { value: number }) => s.value > 0);

  return (
    <section className="mb-9 pt-3">
      <div
        className="flex h-2.5 max-w-[760px] gap-[3px]"
        role="img"
        aria-label={segments
          .map((s) => `${BUG_STATUS_LABELS[s.status]} ${s.value}`)
          .join(', ')}
      >
        {segments.map((s) => (
          <span
            key={s.status}
            // flexGrow, not a width percentage: the segments then divide the
            // track between themselves and the 3px gaps come out of the whole
            // rather than out of the last one.
            style={{ flexGrow: s.value, background: RAIL[s.status] }}
            className="rounded-full"
          />
        ))}
      </div>

      <div className="mt-3.5 flex max-w-[760px] flex-wrap gap-x-[22px] gap-y-2">
        {segments.map((s) => (
          <div
            key={s.status}
            className="flex items-center gap-[7px] text-[12.5px] text-[var(--p-second)]"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: RAIL[s.status] }}
            />
            {BUG_STATUS_LABELS[s.status]}{' '}
            <b className="portal-display text-[13px] font-bold tabular-nums text-[var(--p-ink)]">
              {s.value}
            </b>
          </div>
        ))}
      </div>

      {(stats.medianCloseDays !== null || wontFix > 0) && (
        <p className="mt-6 text-[13px] text-[var(--p-faint)]">
          {stats.medianCloseDays !== null && (
            <>
              Typically{' '}
              <b className="portal-display font-semibold text-[var(--p-second)]">
                {formatMedian(stats.medianCloseDays)}
              </b>{' '}
              from report to fix, across the {stats.closedCount} that closed.
            </>
          )}
          {stats.medianCloseDays !== null && wontFix > 0 && ' '}
          {wontFix > 0 && (
            <>
              {wontFix} closed as won&apos;t fix.
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** The rail's hues, declared once in the portal layout beside the chip tints. */
const RAIL: Record<BugReportStatus, string> = {
  new: 'var(--p-rail-new)',
  seen: 'var(--p-rail-seen)',
  in_progress: 'var(--p-rail-prog)',
  resolved: 'var(--p-rail-done)',
  wont_fix: 'var(--p-rail-wont)',
};

/**
 * Days are the wrong unit below one. A team that closes reports in twenty-two
 * hours has earned a number that says so, and "0.9d" reads like a rounding
 * error rather than an achievement.
 */
function formatMedian(days: number | null): string {
  if (days === null) return '—';
  if (days < 1 / 24) return 'under an hour';
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days < 10) return `${days.toFixed(1).replace(/\.0$/, '')} days`;
  return `${Math.round(days)} days`;
}
