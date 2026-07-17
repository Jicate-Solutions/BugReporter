'use client';

/**
 * Resolution-time distribution.
 *
 * A histogram of how long resolved bugs actually took to close — the gap
 * between `created_at` and `resolved_at`, bucketed. Only `status = 'resolved'`
 * bugs are counted: `resolved_at` is also stamped for `wont_fix`, and folding
 * those in would pass off "we gave up" as "we fixed it fast" and skew the math.
 * Self-contained: does its own paginated read of `bug_reports`, no shared code.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

interface ResolvedRow {
  created_at: string | null;
  resolved_at: string | null;
}

interface Bucket {
  label: string;
  count: number;
}

interface Distribution {
  buckets: Bucket[];
  medianHours: number | null;
  sampled: number;
}

const HOUR = 1;
const DAY = 24;
const WEEK = 24 * 7; // 168h
const FOUR_WEEKS = 24 * 7 * 4; // 672h

/** Ordered, mutually-exclusive buckets. First matching wins. */
const BUCKET_DEFS: { label: string; test: (h: number) => boolean }[] = [
  { label: '<1h', test: (h) => h < HOUR },
  { label: '1–24h', test: (h) => h >= HOUR && h < DAY },
  { label: '1–7d', test: (h) => h >= DAY && h < WEEK },
  { label: '1–4w', test: (h) => h >= WEEK && h < FOUR_WEEKS },
  { label: '>4w', test: (h) => h >= FOUR_WEEKS }
];

/** Median of an ascending-sorted array of hours. */
function medianOf(sortedAsc: number[]): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 !== 0 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/** Human-friendly median for the caption. */
function fmtMedian(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return 'under an hour';
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round((hours / 24) * 10) / 10;
  return `${d} day${d === 1 ? '' : 's'}`;
}

export function ResolutionTimeCard({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const PAGE = 1000;
      const rows: ResolvedRow[] = [];
      let from = 0;

      // Paginate: PostgREST caps a page at 1000 rows. Accumulate until a
      // short page proves we've read the tail.
      for (;;) {
        const { data: page, error: qErr } = await supabase
          .from('bug_reports')
          .select('created_at, resolved_at')
          .eq('organization_id', organizationId)
          .eq('status', 'resolved')
          .not('resolved_at', 'is', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);

        if (qErr) throw qErr;

        const batch = (page ?? []) as ResolvedRow[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }

      // Turn each resolved bug into a positive hours-to-resolve value.
      const hoursList: number[] = [];
      for (const r of rows) {
        if (!r.created_at || !r.resolved_at) continue;
        const started = new Date(r.created_at).getTime();
        const ended = new Date(r.resolved_at).getTime();
        if (Number.isNaN(started) || Number.isNaN(ended)) continue;
        const hours = (ended - started) / 3_600_000;
        if (hours < 0) continue; // guard against clock-skewed / bad rows
        hoursList.push(hours);
      }

      const buckets: Bucket[] = BUCKET_DEFS.map((b) => ({ label: b.label, count: 0 }));
      for (const h of hoursList) {
        const idx = BUCKET_DEFS.findIndex((b) => b.test(h));
        if (idx >= 0) buckets[idx].count += 1;
      }

      const sortedAsc = [...hoursList].sort((a, b) => a - b);

      setData({
        buckets,
        medianHours: medianOf(sortedAsc),
        sampled: hoursList.length
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How long bugs take to resolve</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How long bugs take to resolve</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center">
          <p className="text-sm font-medium text-red-600">
            Couldn&apos;t load resolution times
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.sampled === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">How long bugs take to resolve</CardTitle>
          <Clock className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground py-8 text-center text-sm">
            No resolved bugs yet. Once bugs are marked resolved, the spread of how
            long they took will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const peak = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">How long bugs take to resolve</CardTitle>
        <Clock className="h-4 w-4 text-blue-600" />
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.buckets} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              strokeOpacity={0.08}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              width={28}
              tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
              tickLine={false}
              axisLine={false}
              domain={[0, peak <= 4 ? 4 : 'auto']}
            />
            <Tooltip
              cursor={{ fill: 'currentColor', fillOpacity: 0.06 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid rgba(120,120,120,0.25)'
              }}
              labelStyle={{ fontWeight: 600 }}
              formatter={(value: number) => [`${value} bug${value === 1 ? '' : 's'}`, 'Resolved']}
            />
            <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={72} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-muted-foreground mt-3 text-xs">
          Median time to resolve:{' '}
          <span className="text-foreground font-medium">{fmtMedian(data.medianHours)}</span>
          {' · '}
          <span className="tabular-nums">{data.sampled}</span> resolved bug
          {data.sampled === 1 ? '' : 's'} sampled. Bugs marked{' '}
          <span className="font-medium">won&apos;t fix</span> are excluded so the spread
          reflects real fixes only.
        </p>
      </CardContent>
    </Card>
  );
}
