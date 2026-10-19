import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { portalHref, type PortalView } from './portal-url';

interface PortalPaginationProps {
  appSlug: string;
  view: PortalView;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

/**
 * Pagination as real links, inside the table's own footer.
 *
 * The list is server-rendered, so a page is just another URL — back/forward
 * work, a page can be bookmarked, and none of it needs JavaScript. Every
 * parameter describing the current view is carried by portalHref(); losing `u`
 * here would empty the page.
 *
 * Rendered even at a single page, because the range label ("1–10 of 27") is the
 * only place the list states its own size.
 */
export function PortalPagination({
  appSlug,
  view,
  page,
  totalPages,
  total,
  pageSize,
}: PortalPaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 bg-[var(--p-sunken)] px-5 py-[13px]"
    >
      <p className="text-[12.5px] tabular-nums text-[var(--p-muted)]">
        {total === 0
          ? 'No reports'
          : `${first}–${last} of ${total} report${total === 1 ? '' : 's'}`}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <PageLink
            href={portalHref(appSlug, view, { page: page - 1 })}
            disabled={page <= 1}
            label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </PageLink>

          <span className="min-w-[34px] text-center text-[12.5px] tabular-nums text-[var(--p-muted)]">
            {page} / {totalPages}
          </span>

          <PageLink
            href={portalHref(appSlug, view, { page: page + 1 })}
            disabled={page >= totalPages}
            label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </PageLink>
        </div>
      )}
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const classes =
    'inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] text-[var(--p-second)] transition-colors';

  // A disabled control must not be focusable or announced as a link.
  if (disabled) {
    return (
      <span
        className={`${classes} pointer-events-none opacity-40`}
        aria-hidden="true"
      >
        {children}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label} className={`${classes} hover:bg-[#f4f4f2]`}>
      {children}
    </Link>
  );
}
