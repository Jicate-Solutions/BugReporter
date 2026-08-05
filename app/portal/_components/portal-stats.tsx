import type { ReporterStats } from '@/lib/services/bug-portal/server';

/**
 * Four numbers, above the fold, answering the question that brought someone here.
 *
 * A reporter opens this page to find out whether anything is happening. The list
 * alone cannot say — twenty-seven rows look the same whether they were all fixed
 * last week or all ignored for a fortnight.
 *
 * Every figure counts this reporter's own reports and says what it counts. The
 * mock these tiles come from carried "last 30 days" under Resolved and a "6d"
 * median; both are windows we do not compute, so the labels here describe the
 * real query instead. A dashboard that rounds toward flattering is a dashboard
 * nobody checks twice.
 */
export function PortalStats({ stats }: { stats: ReporterStats }) {
  if (stats.total === 0) return null;

  const count = (status: string) => stats.byStatus[status] ?? 0;

  const untouched = count('new');
  const open = untouched + count('seen');
  const inProgress = count('in_progress');
  const resolved = count('resolved');
  const wontFix = count('wont_fix');

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Open"
        value={open}
        note={
          untouched > 0
            ? `${untouched} not looked at yet`
            : 'all have been seen'
        }
      />
      <Tile
        label="In progress"
        value={inProgress}
        note={inProgress > 0 ? 'being worked on now' : 'nothing started'}
      />
      <Tile
        label="Resolved"
        value={resolved}
        note={
          wontFix > 0
            ? `${wontFix} more closed as won't fix`
            : `of ${stats.total} you reported`
        }
      />
      <Tile
        label="Typical fix"
        value={formatMedian(stats.medianCloseDays)}
        note={
          stats.medianCloseDays === null
            ? 'nothing closed yet'
            : `median across ${stats.closedCount} closed`
        }
      />
    </div>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--p-line)] bg-[var(--p-card)] px-[18px] py-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">
        {label}
      </div>
      <div className="portal-display text-[28px] font-bold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </div>
      <div className="text-[12px] leading-snug text-[var(--p-muted)]">
        {note}
      </div>
    </div>
  );
}

/**
 * Days are the wrong unit below one. A team that closes reports in twenty-two
 * hours has earned a number that says so, and "0.9d" reads like a rounding
 * error rather than an achievement.
 */
function formatMedian(days: number | null): string {
  if (days === null) return '—';
  if (days < 1 / 24) return '<1h';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 10) return `${days.toFixed(1).replace(/\.0$/, '')}d`;
  return `${Math.round(days)}d`;
}
