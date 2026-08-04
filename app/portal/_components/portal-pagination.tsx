import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PortalPaginationProps {
  appSlug: string;
  /** Everything that must survive a page change: identity, search, status. */
  carry: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

/**
 * Pagination as real links, not buttons.
 *
 * The list is server-rendered, so a page is just another URL — which means
 * back/forward work, a page can be bookmarked, and it all functions with no
 * JavaScript. `carry` threads the reporter's identity and any active search
 * through; losing `u` here would empty the page.
 */
export function PortalPagination({
  appSlug,
  carry,
  page,
  totalPages,
  total,
  pageSize,
}: PortalPaginationProps) {
  if (totalPages <= 1) return null;

  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    Object.entries(carry).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (nextPage > 1) params.set('page', String(nextPage));
    return `/portal/${appSlug}?${params.toString()}`;
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-between gap-4 border-t pt-4"
    >
      <p className="text-muted-foreground text-xs tabular-nums">
        {first}–{last} of {total}
      </p>

      <div className="flex items-center gap-1">
        <PageLink
          href={hrefFor(page - 1)}
          disabled={page <= 1}
          label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </PageLink>

        <span className="text-muted-foreground px-2 text-xs tabular-nums">
          {page} / {totalPages}
        </span>

        <PageLink
          href={hrefFor(page + 1)}
          disabled={page >= totalPages}
          label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </PageLink>
      </div>
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
  const classes = cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
    disabled
      ? 'text-muted-foreground/40 pointer-events-none'
      : 'hover:bg-muted'
  );

  // A disabled control must not be focusable or announced as a link.
  if (disabled) {
    return (
      <span className={classes} aria-hidden="true">
        {children}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label} className={classes}>
      {children}
    </Link>
  );
}
