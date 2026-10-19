'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  BUG_STATUS_BADGE_CLASS,
  BUG_STATUS_LABELS,
  isBugStatus,
} from '@boobalan_jkkn/shared';

interface BugStatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * This badge previously knew only about `open | in_progress | resolved | closed`
 * and fell back to "Open" (red) for anything else — so every `new` bug and every
 * `wont_fix` bug in the database rendered as a red "Open" badge. It now reads
 * the shared vocabulary, which matches what the database actually stores.
 */
export function BugStatusBadge({ status, className }: BugStatusBadgeProps) {
  if (!isBugStatus(status)) {
    // An unrecognised value means the DB CHECK constraint drifted from the
    // constant. Show it verbatim rather than mislabelling it as something else.
    return (
      <Badge variant="outline" className={className}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(BUG_STATUS_BADGE_CLASS[status], className)}
    >
      {BUG_STATUS_LABELS[status]}
    </Badge>
  );
}
