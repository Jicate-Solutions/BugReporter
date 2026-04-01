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

const STATUS_OPTIONS = [
  {
    value: 'new',
    label: 'New',
    className: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
  },
  {
    value: 'seen',
    label: 'Seen',
    className: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200'
  },
  {
    value: 'in_progress',
    label: 'In Progress',
    className:
      'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200'
  },
  {
    value: 'resolved',
    label: 'Resolved',
    className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200'
  },
  {
    value: 'wont_fix',
    label: "Won't Fix",
    className: 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
  }
];

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
