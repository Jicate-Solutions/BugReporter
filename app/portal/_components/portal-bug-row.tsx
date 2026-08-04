import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { PortalStatusBadge } from './portal-status-badge';
import type { PortalBugSummary } from '@/lib/services/bug-portal/server';

interface PortalBugRowProps {
  bug: PortalBugSummary;
  href: string;
}

/**
 * One bug in the reporter's list.
 *
 * Two things earn their place beyond the title and status. Dates are relative
 * ("3 days ago") because a reporter cares how long something has been sitting,
 * not what the calendar said. And a bug the team has replied to is called out —
 * that is the one row worth opening, and no status badge can express it, since a
 * bug can sit in "New" while the team asks a question on the thread.
 */
export function PortalBugRow({ bug, href }: PortalBugRowProps) {
  const age = formatDistanceToNow(new Date(bug.created_at), {
    addSuffix: true,
  });

  return (
    <Link
      prefetch={false}
      href={href}
      className="hover:border-foreground/20 hover:bg-muted/40 block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium">{bug.title}</p>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {bug.description}
          </p>
        </div>
        <PortalStatusBadge status={bug.status} />
      </div>

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono">{bug.display_id}</span>
        <span aria-hidden="true">·</span>
        <span>Reported {age}</span>

        {bug.noteCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className={
                bug.awaitingReporter
                  ? 'text-foreground inline-flex items-center gap-1 font-medium'
                  : 'inline-flex items-center gap-1'
              }
            >
              <MessageSquare className="h-3 w-3" />
              {bug.awaitingReporter
                ? bug.noteCount === 1
                  ? 'The team replied'
                  : `The team replied · ${bug.noteCount} notes`
                : `${bug.noteCount} note${bug.noteCount === 1 ? '' : 's'}`}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
