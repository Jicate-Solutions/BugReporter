import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ImageOff, MessageSquare, Paperclip, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PortalStatusBadge } from './portal-status-badge';
import { isTerminalBugStatus, isBugStatus } from '@boobalan_jkkn/shared';
import type { PortalBugSummary } from '@/lib/services/bug-portal/server';

interface PortalBugRowProps {
  bug: PortalBugSummary;
  href: string;
}

/** Left-edge rail colour per status — the list reads as a column of state. */
const STATUS_RAIL: Record<string, string> = {
  new: 'bg-blue-500',
  seen: 'bg-amber-500',
  in_progress: 'bg-orange-500',
  resolved: 'bg-emerald-500',
  wont_fix: 'bg-gray-400',
};

/**
 * Descriptions frequently repeat the title verbatim — of the eleven rows on the
 * first live page, eight did. Rendering both wastes half the row on nothing, so
 * a description that adds no information is dropped.
 */
function addsInformation(title: string, description: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const t = normalize(title);
  const d = normalize(description);
  if (!d || d === t) return false;
  // Also catch "title" vs "title - dropdown" style near-duplicates.
  return !(d.startsWith(t) && d.length - t.length < 12);
}

export function PortalBugRow({ bug, href }: PortalBugRowProps) {
  const age = formatDistanceToNow(new Date(bug.created_at), { addSuffix: true });
  const done = isBugStatus(bug.status) && isTerminalBugStatus(bug.status);
  const showDescription = addsInformation(bug.title, bug.description);

  return (
    <Link
      prefetch={false}
      href={href}
      className={cn(
        'group relative flex gap-4 overflow-hidden rounded-lg border py-3 pl-5 pr-4 transition-all',
        'hover:border-foreground/25 hover:shadow-sm',
        // Finished work recedes so the open backlog dominates the page.
        done && 'opacity-70 hover:opacity-100'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          STATUS_RAIL[bug.status] ?? 'bg-gray-300'
        )}
      />

      {/* The screenshot is the thing a reporter recognises a bug by — far
          faster than reading a title they typed in a hurry. */}
      <div className="bg-muted relative hidden h-16 w-24 shrink-0 overflow-hidden rounded border sm:block">
        {bug.screenshot_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bug.screenshot_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="text-muted-foreground/40 flex h-full items-center justify-center">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate font-medium leading-6">{bug.title}</p>
          <PortalStatusBadge status={bug.status} />
        </div>

        {showDescription && (
          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
            {bug.description}
          </p>
        )}

        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-mono tracking-tight">{bug.display_id}</span>
          <span aria-hidden="true" className="opacity-40">
            &middot;
          </span>
          <span>{age}</span>

          {/* A reopened bug that looks identical to a fresh one is the failure
              mode worth designing against — it is the reporter's disagreement,
              and it should not disappear into the list. */}
          {bug.reopenCount > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700">
              <RotateCcw className="h-3 w-3" />
              Reopened{bug.reopenCount > 1 ? ` ${bug.reopenCount}×` : ''}
            </span>
          )}

          {bug.attachments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {bug.attachments.length}
            </span>
          )}

          {bug.noteCount > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                bug.awaitingReporter && 'text-foreground font-medium'
              )}
            >
              <MessageSquare className="h-3 w-3" />
              {bug.awaitingReporter
                ? 'The team replied'
                : `${bug.noteCount} note${bug.noteCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
