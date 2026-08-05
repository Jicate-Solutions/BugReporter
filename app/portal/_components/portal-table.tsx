import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Image as ImageIcon, MessageSquare, RotateCcw } from 'lucide-react';
import { PortalStatusBadge } from './portal-status-badge';
import type { PortalBugSummary } from '@/lib/services/bug-portal/server';

interface PortalTableProps {
  bugs: PortalBugSummary[];
  hrefFor: (bug: PortalBugSummary) => string;
  children?: React.ReactNode;
}

/**
 * The reporter's own reports, as a table.
 *
 * Five columns, not the six the design called for. The sixth was Severity, and
 * there is no severity anywhere in the schema — the SDK has never collected it.
 * Rather than leave a column of invented Blocker / Major / Minor labels, the slot
 * goes to Where: the part of the application a report came from, read off the
 * captured page path, which splits this reporter's reports into groups that mean
 * something to them.
 *
 * The grid collapses to a two-line stack below the medium breakpoint. Fixed
 * column widths are what make a table scannable and also what makes it useless
 * on a phone, and a reporter following a link from an email is often on one.
 */
const GRID =
  'md:grid md:grid-cols-[96px_1fr_132px_128px_92px] md:items-center md:gap-4';

export function PortalTable({ bugs, hrefFor, children }: PortalTableProps) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--p-line)] bg-[var(--p-card)]">
      <div
        className={`hidden border-b border-[var(--p-line-soft)] bg-[var(--p-sunken)] px-5 py-[11px] text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[var(--p-faint)] ${GRID}`}
      >
        <div>ID</div>
        <div>Report</div>
        <div>Where</div>
        <div>Status</div>
        <div className="text-right">Updated</div>
      </div>

      {bugs.map((bug) => (
        <Row key={bug.id} bug={bug} href={hrefFor(bug)} />
      ))}

      {children}
    </div>
  );
}

function Row({ bug, href }: { bug: PortalBugSummary; href: string }) {
  const updated = formatDistanceToNow(new Date(bug.lastActivityAt), {
    addSuffix: false,
  });
  const showDescription = addsInformation(bug.title, bug.description);
  const imageCount =
    bug.attachments.filter((a) =>
      a.filetype?.startsWith('image/') ?? /\.(png|jpe?g|gif|webp)$/i.test(a.url)
    ).length + (bug.screenshot_url ? 1 : 0);

  return (
    <Link
      href={href}
      prefetch={false}
      className={`block border-b border-[var(--p-line-row)] px-5 py-3.5 transition-colors last:border-b-0 hover:bg-[var(--p-hover)] ${GRID}`}
    >
      {/* Mobile puts status first because it is the answer people came for.
          Desktop keeps it in column order, where the vertical alignment does
          that job instead. */}
      <div className="mb-1.5 flex items-center justify-between gap-3 md:hidden">
        <span className="portal-mono flex items-center gap-2 text-[12px] text-[var(--p-muted)]">
          <UnreadMark show={bug.awaitingReporter} />
          {bug.display_id}
        </span>
        <PortalStatusBadge status={bug.status} />
      </div>

      <div className="portal-mono hidden items-center gap-2 text-[12px] tracking-[-0.01em] text-[var(--p-muted)] md:flex">
        <UnreadMark show={bug.awaitingReporter} />
        {bug.display_id}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-[9px]">
          <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
            {bug.title}
          </span>

          {bug.noteCount > 0 && (
            <span
              className={`portal-mono flex shrink-0 items-center gap-1 text-[11.5px] ${
                bug.awaitingReporter
                  ? 'font-medium text-[#8a5a12]'
                  : 'text-[var(--p-muted)]'
              }`}
              title={
                bug.awaitingReporter
                  ? 'The team replied — waiting on you'
                  : `${bug.noteCount} note${bug.noteCount === 1 ? '' : 's'}`
              }
            >
              <MessageSquare className="h-3 w-3" />
              {bug.noteCount}
            </span>
          )}

          {imageCount > 0 && (
            <span
              className="portal-mono flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--p-muted)]"
              title={`${imageCount} image${imageCount === 1 ? '' : 's'}`}
            >
              <ImageIcon className="h-3 w-3" />
              {imageCount}
            </span>
          )}

          {bug.reopenCount > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-[#8a5a12]"
              title="You said this was still broken"
            >
              <RotateCcw className="h-3 w-3" />
              {bug.reopenCount > 1 ? `${bug.reopenCount}×` : 'Reopened'}
            </span>
          )}
        </div>

        {showDescription && (
          <div className="mt-[3px] truncate text-[13px] text-[var(--p-muted)]">
            {bug.description}
          </div>
        )}

        <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--p-faint)] md:hidden">
          {bug.area && <span>{bug.area}</span>}
          {bug.area && <span aria-hidden="true">·</span>}
          <span>{updated} ago</span>
        </div>
      </div>

      <div className="hidden truncate text-[12.5px] text-[var(--p-second)] md:block">
        {bug.area ?? <span className="text-[var(--p-faint)]">—</span>}
      </div>

      <div className="hidden md:block">
        <PortalStatusBadge status={bug.status} />
      </div>

      <div className="hidden text-right text-[12.5px] tabular-nums text-[var(--p-faint)] md:block">
        {updated}
      </div>
    </Link>
  );
}

/**
 * One dot: there is something here you have not answered.
 *
 * Deliberately a mark rather than a message. The row already carries a note
 * count and a status; what it could not say is which rows are *waiting on the
 * reader*, and that is the one thing worth a fixed position at the start of the
 * line where the eye can run straight down it.
 *
 * It clears when the reporter replies, not when they open the report. There is
 * no read tracking in the schema, so "opened" is not something the server can
 * know — and of the two, "you still owe them an answer" is the more useful
 * thing to keep showing.
 *
 * The empty span holds the column when there is nothing to mark, so IDs stay
 * aligned down the list instead of shifting left and right per row.
 */
function UnreadMark({ show }: { show: boolean }) {
  if (!show) return <span aria-hidden="true" className="w-1.5 shrink-0" />;

  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#c2410c]"
      role="img"
      aria-label="The team replied — waiting on you"
      title="The team replied — waiting on you"
    />
  );
}

/**
 * Descriptions frequently repeat the title verbatim — of the eleven rows on the
 * first live page, eight did. Rendering both wastes the row on nothing, so a
 * description that adds no information is dropped.
 */
function addsInformation(title: string, description: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const t = normalize(title);
  const d = normalize(description);
  if (!d || d === t) return false;
  // Also catch "title" vs "title - dropdown" style near-duplicates.
  return !(d.startsWith(t) && d.length - t.length < 12);
}
