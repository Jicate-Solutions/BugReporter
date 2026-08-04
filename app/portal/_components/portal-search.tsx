import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';

interface PortalSearchProps {
  /** Params that identify the reporter and must survive every navigation. */
  identity: { u: string; sig?: string };
  appSlug: string;
  q: string;
  status: string;
  counts: { total: number; byStatus: Record<string, number> };
}

/**
 * Search and status filtering for the reporter's bug list.
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
 */
export function PortalSearch({
  identity,
  appSlug,
  q,
  status,
  counts,
}: PortalSearchProps) {
  const base = `/portal/${appSlug}`;

  const hrefFor = (nextStatus: string) => {
    const params = new URLSearchParams();
    params.set('u', identity.u);
    if (identity.sig) params.set('sig', identity.sig);
    if (q) params.set('q', q);
    if (nextStatus) params.set('status', nextStatus);
    return `${base}?${params.toString()}`;
  };

  const activeStatuses = BUG_STATUSES.filter(
    (s: BugReportStatus) => (counts.byStatus[s] ?? 0) > 0
  );

  return (
    <div className="mb-6 space-y-4">
      <form method="get" action={base} className="flex gap-2">
        <input type="hidden" name="u" value={identity.u} />
        {identity.sig && (
          <input type="hidden" name="sig" value={identity.sig} />
        )}
        {status && <input type="hidden" name="status" value={status} />}

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

      {activeStatuses.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip href={hrefFor('')} active={!status}>
            All <Count>{counts.total}</Count>
          </Chip>
          {activeStatuses.map((s: BugReportStatus) => (
            <Chip key={s} href={hrefFor(s)} active={status === s}>
              {BUG_STATUS_LABELS[s]} <Count>{counts.byStatus[s]}</Count>
            </Chip>
          ))}
        </div>
      )}

      {(q || status) && (
        <Link
          href={`${base}?u=${encodeURIComponent(identity.u)}${
            identity.sig ? `&sig=${encodeURIComponent(identity.sig)}` : ''
          }`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <X className="h-3 w-3" />
          Clear search and filters
        </Link>
      )}
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
