'use client';

/** Month picker for the Bills view: changes ?month=YYYY-MM (IST calendar months). */

import { useRouter, usePathname } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export function MonthPicker({
  month,
  options
}: {
  month: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Select value={month} onValueChange={(v) => router.push(`${pathname}?month=${v}`)}>
      <SelectTrigger className="w-48" aria-label="Bill month">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
