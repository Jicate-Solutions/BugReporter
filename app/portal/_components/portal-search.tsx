import Link from 'next/link';
import { MessageSquare, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import type { ReporterBugSort } from '@/lib/services/bug-portal/server';

interface PortalSearchProps {
  /** Params that identify the reporter and must survive every navigation. */
  identity: { u: string; sig?: string };
  appSlug: string;
  q: string;
  status: string;
  needsReply: boolean;
  sort: ReporterBugSort;
  needsReplyTotal: number;
  counts: { total: number; byStatus: Record<string, number> };
}

const SORT_LABELS: Record<ReporterBugSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  activity: 'Recently active',
};

/**
 * Search, filtering and ordering for the reporter's bug list.
 *
 * A plain GET form, so it works with no JavaScript and every filtered view is a
 * real URL the reporter can bookmark or send to you. The hidden fields carry
 * `u` (and `sig`) through — dropping them would strip the reporter's identity
 * and empty the page.
 *
 * Status is a row of counted chips rather than a dropdown on purpose. The
 * question a reporter actually arrives with is "has anything moved?", and the
 * counts answer it before they touch the search box. Statuses with no bugs are
 * hidden, so the row stays short and every chip leads somewhere.
 *
 * Sort is links rather than a <select> for the same no-JavaScript reason: a
 * select cannot navigate on its own without an onChange handler, and a select
 * that needs a separate Submit click to take effect is worse than three links.
 */
export function PortalSearch({
  identity,
  appSlug,
  q,
  status,
  needsReply,
  sort,
  needsReplyTotal,
  counts,
}: PortalSearchProps) {
  const base = `/portal/${appSlug}`;

  /**
   * Build a URL from the current view with some parts overridden. Everything not
   * named in `overrides` is carried forward — the bug this prevents is a filter
   * chip silently dropping the active search, or the sort resetting when someone
   * picks a status.
   */
  const hrefWith = (
    overrides: Partial<{
      status: string;
      q: string;
      reply: boolean;
      sort: ReporterBugSort;
    }>
  ) => {
    const next = { status, q, reply: needsReply, sort, ...overrides };
    const params = new URLSearchParams();
    params.set('u', identity.u);
    if (identity.sig) params.set('sig', identity.sig);
    if (next.q) params.set('q', next.q);
    if (next.status) params.set('status', next.status);
    if (next.reply) params.set('reply', '1');
    // Omit the default so the common URL stays short and shareable.
    if (next.sort !== 'newest') params.set('sort', next.sort);
    return `${base}?${params.toString()}`;
  };

  const activeStatuses = BUG_STATUSES.filter(
    (s: BugReportStatus) => (counts.byStatus[s] ?? 0) > 0
  );

  const filtering = Boolean(q || status || needsReply || sort !== 'newest');

  return (
    <div className="mb-6 space-y-4">
      <form method="get" action={base} className="flex gap-2">
        <input type="hidden" name="u" value={identity.u} />
        {identity.sig && (
          <input type="hidden" name="sig" value={identity.sig} />
        )}
        {/* Everything the form does not itself edit has to ride along, or
            searching would quietly reset the rest of the view. */}
        {status && <input type="hidden" name="status" value={status} />}
        {needsReply && <input type="hidden" name="reply" value="1" />}
        {sort !== 'newest' && (
          <input type="hidden" name="sort" value={sort} />
        )}

        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search your reports by title or ID…"
            className="pl-9"
            aria-label="Search your bug reports"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {(activeStatuses.length > 1 || needsReplyTotal > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {activeStatuses.length > 1 && (
            <>
              <Chip href={hrefWith({ status: '' })} active={!status}>
                All <Count>{counts.total}</Count>
              </Chip>
              {activeStatuses.map((s: BugReportStatus) => (
                <Chip
                  key={s}
                  href={hrefWith({ status: s })}
                  active={status === s}
                >
                  {BUG_STATUS_LABELS[s]} <Count>{counts.byStatus[s]}</Count>
                </Chip>
              ))}
            </>
          )}

          {/* Hidden at zero rather than rendered as a chip that leads nowhere. */}
          {needsReplyTotal > 0 && (
            <Chip href={hrefWith({ reply: !needsReply })} active={needsReply}>
              <MessageSquare className="h-3 w-3" />
              Needs your reply <Count>{needsReplyTotal}</Count>
            </Chip>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <span>Sort</span>
          {(Object.keys(SORT_LABELS) as ReporterBugSort[]).map((option) => (
            <Link
              key={option}
              href={hrefWith({ sort: option })}
              aria-current={sort === option ? 'true' : undefined}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                sort === option
                  ? 'text-foreground font-medium'
                  : 'hover:text-foreground'
              )}
            >
              {SORT_LABELS[option]}
            </Link>
          ))}
        </div>

        {filtering && (
          <Link
            href={`${base}?u=${encodeURIComponent(identity.u)}${
              identity.sig ? `&sig=${encodeURIComponent(identity.sig)}` : ''
            }`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <X className="h-3 w-3" />
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'bg-foreground text-background border-transparent'
          : 'hover:bg-muted'
      )}
    >
      {children}
    </Link>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums opacity-60">{children}</span>;
}
