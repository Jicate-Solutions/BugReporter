import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Image as ImageIcon, MessageSquare, Pencil, RotateCcw } from 'lucide-react';
import { PortalRowLink } from './portal-row-link';
import { PortalStatusBadge } from './portal-status-badge';
import { PortalStatusControl } from './portal-status-control';
import type { PortalBugSummary } from '@/lib/services/bug-portal/server';

/**
 * The identity and permissions a row needs to make its status chip editable.
 *
 * Passed as one object rather than four loose props because they are only ever
 * meaningful together: present means this application has opted in and the
 * reporter is known, absent means the row renders a plain badge. A boolean plus
 * three possibly-undefined strings would let those two states drift apart.
 */
export interface PortalTableEditStatus {
  appSlug: string;
  reporterEmail: string;
  signature?: string;
  canReopen: boolean;
}

interface PortalTableProps {
  bugs: PortalBugSummary[];
  hrefFor: (bug: PortalBugSummary) => string;
  editStatus?: PortalTableEditStatus;
  /**
   * Where a row's "mark up this screenshot" link goes. Absent when the
   * application has not turned annotation on, in which case the thumbnail stays
   * a picture and nothing suggests otherwise.
   */
  annotateHrefFor?: (bug: PortalBugSummary) => string;
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

export function PortalTable({
  bugs,
  hrefFor,
  editStatus,
  annotateHrefFor,
  children,
}: PortalTableProps) {
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
        <Row
          key={bug.id}
          bug={bug}
          href={hrefFor(bug)}
          editStatus={editStatus}
          annotateHref={annotateHrefFor?.(bug)}
        />
      ))}

      {children}
    </div>
  );
}

function Row({
  bug,
  href,
  editStatus,
  annotateHref,
}: {
  bug: PortalBugSummary;
  href: string;
  editStatus?: PortalTableEditStatus;
  annotateHref?: string;
}) {
  const updated = formatDistanceToNow(new Date(bug.lastActivityAt), {
    addSuffix: false,
  });
  const showDescription = addsInformation(bug.title, bug.description);
  const images = bug.attachments.filter(isImage);
  const imageCount = images.length + (bug.screenshot_url ? 1 : 0);

  // The capture taken at the moment it broke. Every report carries one and the
  // list spent it on a "🖼 1" icon, which is the least it could possibly say —
  // a reporter recognises their own screen faster than the title they typed in
  // a hurry, especially at sixteen days' distance.
  const thumb = bug.screenshot_url ?? images[0]?.url ?? null;

  const status = editStatus ? (
    // z-10 lifts it clear of the link overlay below. Without it the chip is
    // painted under a transparent anchor and every click navigates instead of
    // opening the menu.
    <span className="relative z-10">
      <PortalStatusControl
        appSlug={editStatus.appSlug}
        bugId={bug.id}
        status={bug.status}
        reporterEmail={editStatus.reporterEmail}
        signature={editStatus.signature}
        canReopen={editStatus.canReopen}
      />
    </span>
  ) : (
    <PortalStatusBadge status={bug.status} />
  );

  return (
    <div
      className={`relative border-b border-[var(--p-line-row)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--p-hover)] ${GRID}`}
    >
      {/*
        The row used to be a single <a> wrapping everything, which is the
        simplest thing that works right up until a control has to live inside
        it: a <button> inside an <a> is invalid, and the anchor swallows its
        clicks anyway. So the link becomes an invisible overlay and the cells
        become its siblings. Positioned elements paint above unpositioned ones
        regardless of source order, so the overlay covers the whole row by
        default and only what is explicitly raised sits on top of it.

        The cost is that the link no longer contains the title, so it has no
        text to take an accessible name from and has to be given one.
      */}
      <PortalRowLink
        href={href}
        aria-label={`${bug.display_id}: ${bug.title}`}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--p-accent)]"
      />

      {/* Mobile puts status first because it is the answer people came for.
          Desktop keeps it in column order, where the vertical alignment does
          that job instead. */}
      <div className="mb-1.5 flex items-center justify-between gap-3 md:hidden">
        <span className="portal-mono flex items-center gap-2 text-[12px] text-[var(--p-muted)]">
          <UnreadMark show={bug.awaitingReporter} />
          {bug.display_id}
        </span>
        {status}
      </div>

      <div className="portal-mono hidden items-center gap-2 text-[12px] tracking-[-0.01em] text-[var(--p-muted)] md:flex">
        <UnreadMark show={bug.awaitingReporter} />
        {bug.display_id}
      </div>

      <div className="flex min-w-0 gap-3.5">
        {thumb && (
          /*
            object-left-top, not center: a screenshot of a broken page is almost
            always broken at the top-left, where the header, the breadcrumb and
            the first field are. Centring an 84×52 crop of a 1366px capture lands
            in the middle of an empty table.

            alt is empty on purpose — the row link already carries the report's
            name, and there is nothing truthful to say about the picture that the
            title does not already say.
          */
          <span className="relative block h-[52px] w-[84px] shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              loading="lazy"
              className="h-full w-full rounded-[7px] border border-[var(--p-line)] bg-[var(--p-sunken)] object-cover object-left-top"
            />

            {annotateHref && (
              /*
                The picture is the button.

                Marking up a screenshot used to mean opening the report and
                finding a control below the fold — three steps for the thing a
                reporter most wants to do, which is point at what is wrong. The
                thumbnail is already the most recognisable thing in the row, so
                it is what you click.

                z-10 for the same reason the status chip has it: the row's link
                is a transparent overlay painted above the cells, and anything
                meant to be clickable has to sit above that in turn.

                The pencil is always drawn rather than revealed on hover — a
                hover-only affordance does not exist on a phone, and this has to
                be findable, which is the entire point of moving it here.
              */
              <Link
                href={annotateHref}
                prefetch={false}
                title="Mark up this screenshot"
                aria-label={`Mark up the screenshot for ${bug.display_id}`}
                className="group absolute inset-0 z-10 rounded-[7px] outline-none"
              >
                <span className="absolute inset-0 rounded-[7px] bg-[rgba(20,22,25,0.45)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span className="absolute bottom-1 right-1 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[rgba(20,22,25,0.72)] transition-colors group-hover:bg-[var(--p-accent)]">
                  <Pencil className="h-2.5 w-2.5 text-white" />
                </span>
              </Link>
            )}
          </span>
        )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[9px]">
          <span className="truncate text-[15.5px] font-semibold tracking-[-0.011em]">
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

          {/*
            Only once the count says something the picture does not. With a
            thumbnail on the row, "1 image" is the same fact twice — the mark
            earns its place from the second image onward, where it is the only
            way to know the rest are there.
          */}
          {imageCount > (thumb ? 1 : 0) && (
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
      </div>

      <div className="hidden truncate text-[12.5px] text-[var(--p-second)] md:block">
        {bug.area ?? <span className="text-[var(--p-faint)]">—</span>}
      </div>

      <div className="hidden md:block">{status}</div>

      <div className="hidden text-right text-[12.5px] tabular-nums text-[var(--p-faint)] md:block">
        {updated}
      </div>
    </div>
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
 * What counts as an image.
 *
 * `attachments` is untyped JSONB written by SDK versions that have drifted, so
 * filetype is not guaranteed to be there — the extension check is the fallback,
 * not the belt. Shared by the count and the thumbnail so a row can never show
 * "2 images" beside no picture.
 */
function isImage(a: { filetype?: string | null; url: string }): boolean {
  return a.filetype?.startsWith('image/') ?? /\.(png|jpe?g|gif|webp)$/i.test(a.url);
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
