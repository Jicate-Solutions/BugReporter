'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useUpdateBugStatus } from '@/hooks/bug-reports/use-bug-reports';
import { cn } from '@/lib/utils';
import {
  BUG_STATUSES,
  BUG_STATUS_BADGE_CLASS,
  BUG_STATUS_LABELS,
  SELECTABLE_BUG_STATUSES,
  isBugStatus,
  offerableBugStatuses,
  type BugReportStatus
} from '@boobalan_jkkn/shared';

const STATUS_HOVER_CLASS: Record<BugReportStatus, string> = {
  new: 'hover:bg-blue-200',
  seen: 'hover:bg-amber-200',
  in_progress: 'hover:bg-orange-200',
  ready_for_testing: 'hover:bg-cyan-200',
  resolved: 'hover:bg-green-200',
  closed: 'hover:bg-emerald-300',
  wont_fix: 'hover:bg-gray-200'
};

// Every status the trigger may have to DRAW, which is all of them — a bug still
// sitting in the legacy `resolved` has to render as Resolved. What the dropdown
// OFFERS is a narrower question, answered per-bug by offerableBugStatuses below.
const STATUS_CLASS = Object.fromEntries(
  BUG_STATUSES.map((value) => [
    value,
    cn(BUG_STATUS_BADGE_CLASS[value], STATUS_HOVER_CLASS[value])
  ])
) as Record<BugReportStatus, string>;

interface InlineStatusSelectProps {
  bugId: string;
  currentStatus: string;
  onSuccess?: () => void;
}

export function InlineStatusSelect({
  bugId,
  currentStatus,
  onSuccess
}: InlineStatusSelectProps) {
  const { updateStatus, updating } = useUpdateBugStatus();
  const [optimisticStatus, setOptimisticStatus] = useState(currentStatus);

  // Sync when parent data refreshes
  useEffect(() => {
    setOptimisticStatus(currentStatus);
  }, [currentStatus]);

  // Narrowed rather than defaulted through `|| STATUS_OPTIONS[0]`, which turned
  // any status this list did not carry into a trigger reading "New" — a silent
  // misreport of the bug's actual state.
  const current: BugReportStatus = isBugStatus(optimisticStatus)
    ? optimisticStatus
    : 'new';

  // `resolved` is legacy: still rendered, no longer offered. Moving a bug into
  // it is what stranded the ~399 rows the portal cannot complete, so the only
  // bug that still shows it is one already there — and that row is disabled,
  // because re-picking the current status is a no-op the server rejects anyway.
  const options = offerableBugStatuses(current);

  const handleChange = async (newStatus: string) => {
    const prevStatus = optimisticStatus;
    setOptimisticStatus(newStatus);
    try {
      await updateStatus(bugId, newStatus);
      onSuccess?.();
    } catch {
      setOptimisticStatus(prevStatus);
    }
  };

  return (
    // Stop propagation so clicking the select doesn't trigger row navigation
    <div onClick={(e) => e.stopPropagation()} className='relative w-fit'>
      {updating && (
        <div className='absolute inset-0 z-10 flex items-center justify-center rounded bg-background/60'>
          <Loader2 className='h-3 w-3 animate-spin' />
        </div>
      )}
      <Select
        value={optimisticStatus}
        onValueChange={handleChange}
        disabled={updating}
      >
        <SelectTrigger
          className={cn(
            'h-7 w-[120px] rounded-full border px-3 text-xs font-medium shadow-none focus:ring-0 focus:ring-offset-0',
            STATUS_CLASS[current]
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option}
              value={option}
              disabled={!SELECTABLE_BUG_STATUSES.includes(option)}
              className='text-xs'
            >
              {BUG_STATUS_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
