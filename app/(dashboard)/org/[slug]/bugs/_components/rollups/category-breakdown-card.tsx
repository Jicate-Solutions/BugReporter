'use client';

/**
 * Bugs by category (cross-app rollup slice).
 *
 * Answers "what KIND of problems is this org reporting?" — a horizontal bar
 * chart of bug count per category across every application, noisiest first.
 * Security is emphasised in red because a single open security bug outweighs a
 * pile of feature requests. Self-contained: does its own paginated read of the
 * `category` column and aggregates client-side. No schema change, pure read.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Tags } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

/** The six real category values, with human-readable labels. */
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  ui_design: 'UI / design',
  feature_request: 'Feature request',
  performance: 'Performance',
  security: 'Security',
  other: 'Other'
};
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

const PAGE_SIZE = 1000;
const PRIMARY = '#2563eb';
const RISK = '#dc2626';

/** Only the field we read — the generated BugReport type is untrustworthy. */
type CategoryRow = { category: string | null };

interface CategoryDatum {
  key: string;
  label: string;
  count: number;
}

export function CategoryBreakdownCard({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<CategoryDatum[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // Paginate past the PostgREST 1000-row cap — accumulate every category
      // value for the org, then aggregate in memory.
      const rows: CategoryRow[] = [];
      let from = 0;
      for (;;) {
        const { data: page, error: pageError } = await supabase
          .from('bug_reports')
          .select('category')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageError) throw new Error(pageError.message);

        const batch = (page ?? []) as CategoryRow[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const counts = new Map<string, number>();
      for (const key of CATEGORY_KEYS) counts.set(key, 0);
      for (const row of rows) {
        const key = row.category;
        if (key && counts.has(key)) counts.set(key, counts.get(key)! + 1);
      }

      const aggregated: CategoryDatum[] = CATEGORY_KEYS.map((key) => ({
        key,
        label: CATEGORY_LABELS[key],
        count: counts.get(key)!
      })).sort((a, b) => b.count - a.count);

      setData(aggregated);
      setTotal(rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Bugs by category</CardTitle>
        <Tags className="text-blue-600 h-4 w-4" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[280px] w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-red-600">
              Couldn&apos;t load the category breakdown
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{error}</p>
          </div>
        ) : !data || total === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No bugs reported yet. Once applications start filing bugs, their category
            breakdown appears here.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  strokeOpacity={0.08}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={110}
                  tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.75 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid rgba(120,120,120,0.25)'
                  }}
                  labelStyle={{ fontWeight: 600 }}
                  formatter={(value: number) => [`${value}`, 'Bugs']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26}>
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.key === 'security' ? RISK : PRIMARY} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="right"
                    className="fill-foreground text-xs tabular-nums"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-muted-foreground mt-3 text-xs tabular-nums">
              Based on {total} {total === 1 ? 'bug' : 'bugs'} across all applications.
              Security bugs are highlighted in red.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
