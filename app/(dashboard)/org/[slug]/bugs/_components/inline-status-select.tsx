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

// Derived from the shared vocabulary so this dropdown can never drift from what
// the database accepts. The hover states are the only thing local to this view.
const STATUS_OPTIONS = BUG_STATUSES.map((value) => ({
  value,
  label: BUG_STATUS_LABELS[value],
  className: cn(BUG_STATUS_BADGE_CLASS[value], STATUS_HOVER_CLASS[value])
}));

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

  const config =
    STATUS_OPTIONS.find((s) => s.value === optimisticStatus) ||
    STATUS_OPTIONS[0];

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
            config.className
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className='text-xs'>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
