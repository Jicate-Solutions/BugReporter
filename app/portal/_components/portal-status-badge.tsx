import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  BUG_STATUS_BADGE_CLASS,
  BUG_STATUS_LABELS,
  isBugStatus,
} from '@boobalan_jkkn/shared';

/**
 * Reporter-facing status badge. Shares the dashboard's vocabulary and colours so
 * a reporter and a developer looking at the same bug see the same words.
 */
export function PortalStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  if (!isBugStatus(status)) {
    return (
      <Badge variant="outline" className={className}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn('shrink-0', BUG_STATUS_BADGE_CLASS[status], className)}
    >
      {BUG_STATUS_LABELS[status]}
    </Badge>
  );
}
