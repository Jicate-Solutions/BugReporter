'use client';

/**
 * Throughput — new vs resolved (30 days).
 *
 * A self-contained analytics section for the cross-app bug dashboard. It reads
 * the last 30 days of `bug_reports` for one org and buckets two independent
 * signals by LOCAL calendar day: bugs CREATED per day (by created_at) and bugs
 * RESOLVED per day (by resolved_at, status = resolved only — wont_fix also
 * stamps resolved_at so it must be excluded to keep the resolved line honest).
 * A headline stat shows net backlog change over the window (created - resolved):
 * growing backlog is bad (red, up-arrow), shrinking is good (green, down-arrow).
 *
 * Pure new read. No schema change, no shared-file edits — everything lives here.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Activity, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

const WINDOW_DAYS = 30;
const PAGE = 1000;

const COLOR_CREATED = '#2563eb';
const COLOR_RESOLVED = '#16a34a';
const COLOR_RISK = '#dc2626';

interface CreatedRow {
  created_at: string;
}

interface ResolvedRow {
  resolved_at: string | null;
}

interface DayBucket {
  key: string;
  label: string;
  created: number;
  resolved: number;
}

interface Throughput {
  buckets: DayBucket[];
  totalCreated: number;
  totalResolved: number;
}

/** Local calendar-day key (YYYY-MM-DD in the viewer's timezone). */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Short human label, e.g. "Jul 17". */
function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ThroughputTrendCard({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Throughput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Throughput> => {
    const supabase = createClient();

    // 30 local-day buckets, oldest first, keyed for O(1) lookup.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowStart = new Date(startOfToday);
    windowStart.setDate(windowStart.getDate() - (WINDOW_DAYS - 1));
    const windowStartISO = windowStart.toISOString();

    const buckets: DayBucket[] = [];
    const index = new Map<string, DayBucket>();
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      const bucket: DayBucket = {
        key: localDayKey(d),
        label: dayLabel(d),
        created: 0,
        resolved: 0
      };
      buckets.push(bucket);
      index.set(bucket.key, bucket);
    }

    // --- Created series: every bug created inside the window (paginated). ---
    const createdRows: CreatedRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: err } = await supabase
        .from('bug_reports')
        .select('created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', windowStartISO)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (err) throw new Error(err.message);
      const rows = (page ?? []) as CreatedRow[];
      createdRows.push(...rows);
      if (rows.length < PAGE) break;
    }

    // --- Resolved series: status = resolved only (wont_fix excluded), paginated. ---
    const resolvedRows: ResolvedRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: err } = await supabase
        .from('bug_reports')
        .select('resolved_at')
        .eq('organization_id', organizationId)
        .eq('status', 'resolved')
        .gte('resolved_at', windowStartISO)
        .order('resolved_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (err) throw new Error(err.message);
      const rows = (page ?? []) as ResolvedRow[];
      resolvedRows.push(...rows);
      if (rows.length < PAGE) break;
    }

    let totalCreated = 0;
    for (const row of createdRows) {
      const bucket = index.get(localDayKey(new Date(row.created_at)));
      if (bucket) {
        bucket.created += 1;
        totalCreated += 1;
      }
    }

    let totalResolved = 0;
    for (const row of resolvedRows) {
      if (!row.resolved_at) continue;
      const bucket = index.get(localDayKey(new Date(row.resolved_at)));
      if (bucket) {
        bucket.resolved += 1;
        totalResolved += 1;
      }
    }

    return { buckets, totalCreated, totalResolved };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Throughput — new vs resolved (30 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Throughput — new vs resolved (30 days)</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center">
          <p className="text-sm font-medium text-red-600">Couldn&apos;t load throughput</p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const hasActivity =
    data != null && (data.totalCreated > 0 || data.totalResolved > 0);

  if (!data || !hasActivity) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Throughput — new vs resolved (30 days)</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          No bugs were created or resolved in the last 30 days. Once activity picks up,
          the daily new-vs-resolved trend appears here.
        </CardContent>
      </Card>
    );
  }

  const net = data.totalCreated - data.totalResolved;
  const growing = net > 0;
  const shrinking = net < 0;
  const netColor = growing ? COLOR_RISK : shrinking ? COLOR_RESOLVED : undefined;
  const NetIcon = growing ? ArrowUp : shrinking ? ArrowDown : Minus;
  const netLabel = growing
    ? 'backlog growing'
    : shrinking
      ? 'backlog shrinking'
      : 'backlog steady';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Throughput — new vs resolved (30 days)</CardTitle>
        <Activity className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent>
        {/* Headline: net backlog change over the window. */}
        <div className="mb-4 flex items-baseline gap-3">
          <div
            className="flex items-center gap-1 text-3xl font-bold tabular-nums"
            style={netColor ? { color: netColor } : undefined}
          >
            <NetIcon className="h-6 w-6" />
            {net > 0 ? `+${net}` : net}
          </div>
          <div className="text-muted-foreground text-sm">
            <span className="font-medium" style={netColor ? { color: netColor } : undefined}>
              {netLabel}
            </span>{' '}
            over 30 days
            <span className="ml-1 tabular-nums">
              ({data.totalCreated} new − {data.totalResolved} resolved)
            </span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={data.buckets}
            margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
          >
            <defs>
              <linearGradient id="throughputCreatedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR_CREATED} stopOpacity={0.3} />
                <stop offset="100%" stopColor={COLOR_CREATED} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="throughputResolvedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR_RESOLVED} stopOpacity={0.3} />
                <stop offset="100%" stopColor={COLOR_RESOLVED} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              strokeOpacity={0.08}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              allowDecimals={false}
              width={28}
              tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: COLOR_CREATED, strokeOpacity: 0.25 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid rgba(120,120,120,0.25)'
              }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="plainline"
            />
            <Area
              type="monotone"
              dataKey="created"
              name="Created"
              stroke={COLOR_CREATED}
              strokeWidth={2}
              fill="url(#throughputCreatedFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="resolved"
              name="Resolved"
              stroke={COLOR_RESOLVED}
              strokeWidth={2}
              fill="url(#throughputResolvedFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        <p className="text-muted-foreground mt-3 text-xs">
          Daily counts bucketed by local calendar day. &quot;Created&quot; counts bugs by
          report date; &quot;Resolved&quot; counts bugs marked resolved by their resolve
          date (dropped / won&apos;t-fix bugs are excluded so the resolved line reflects
          real fixes).
        </p>
      </CardContent>
    </Card>
  );
}
