'use client';

/**
 * Aging / SLA risk (cross-app rollup slice).
 *
 * Answers "how long have the bugs that still need work been sitting?" — for
 * ACTIVE bugs only (anything not yet resolved or won't-fix), it buckets each by
 * age since it was reported into <1d, 1–7d, 7–30d and >30d, and surfaces the
 * five oldest as the concrete backlog to chase. The >30-day bucket is drawn in
 * red because those are the ones quietly breaching any reasonable SLA.
 * Self-contained: does its own paginated read and aggregates client-side. No
 * schema change, pure read.
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
import { AlarmClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { createClient } from '@/lib/supabase/client';

const PAGE_SIZE = 1000;

/** Sanctioned palette — fresh (green) → primary → warn (amber) → risk (red). */
const GOOD = '#16a34a';
const PRIMARY = '#2563eb';
const WARN = '#f59e0b';
const RISK = '#dc2626';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only the fields we read — the generated BugReport type is untrustworthy. */
type BugRow = {
  application_id: string | null;
  status: string | null;
  created_at: string;
  display_id: string | null;
  description: string | null;
};

/** A bug is ACTIVE (still needs work) unless it is resolved or won't-fix. */
function isActive(status: string | null): boolean {
  return status !== 'resolved' && status !== 'wont_fix';
}

/** Which age bucket an active bug falls in, given its age in ms. */
function bucketOf(ageMs: number): '<1d' | '1-7d' | '7-30d' | '>30d' {
  const days = ageMs / DAY_MS;
  if (days < 1) return '<1d';
  if (days < 7) return '1-7d';
  if (days < 30) return '7-30d';
  return '>30d';
}

/** Human-friendly age like "42d" / "6h" / "<1h". */
function fmtAge(ageMs: number): string {
  const days = Math.floor(ageMs / DAY_MS);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  return '<1h';
}

/** A short, single-line label for a bug row. */
function bugLabel(row: BugRow): string {
  if (row.display_id) return row.display_id;
  const desc = (row.description ?? '').trim().replace(/\s+/g, ' ');
  if (!desc) return 'Untitled bug';
  return desc.length > 60 ? `${desc.slice(0, 60)}…` : desc;
}

interface BucketDatum {
  key: '<1d' | '1-7d' | '7-30d' | '>30d';
  label: string;
  count: number;
  color: string;
}

interface OldestBug {
  id: string;
  label: string;
  appName: string;
  ageMs: number;
  isRisk: boolean;
}

export function AgingRiskCard({ organizationId }: { organizationId: string }) {
  const [buckets, setBuckets] = useState<BucketDatum[] | null>(null);
  const [oldest, setOldest] = useState<OldestBug[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // App id → display name, scoped to this org.
      const { data: appsData, error: appsError } = await supabase
        .from('applications')
        .select('id, name, slug')
        .eq('organization_id', organizationId);
      if (appsError) throw new Error(appsError.message);
      const appNames = new Map<string, string>();
      for (const app of (appsData ?? []) as { id: string; name: string }[]) {
        appNames.set(app.id, app.name);
      }

      // Paginate past the PostgREST 1000-row cap — accumulate every bug for the
      // org, then filter to the active ones and aggregate in memory.
      const rows: BugRow[] = [];
      let from = 0;
      for (;;) {
        const { data: page, error: pageError } = await supabase
          .from('bug_reports')
          .select('application_id, status, created_at, display_id, description')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageError) throw new Error(pageError.message);

        const batch = (page ?? []) as BugRow[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const now = Date.now();
      const active = rows
        .filter((r) => isActive(r.status))
        .map((r) => ({ row: r, ageMs: Math.max(0, now - new Date(r.created_at).getTime()) }));

      const counts: Record<BucketDatum['key'], number> = {
        '<1d': 0,
        '1-7d': 0,
        '7-30d': 0,
        '>30d': 0
      };
      for (const { ageMs } of active) counts[bucketOf(ageMs)] += 1;

      const aggregated: BucketDatum[] = [
        { key: '<1d', label: '< 1 day', count: counts['<1d'], color: GOOD },
        { key: '1-7d', label: '1–7 days', count: counts['1-7d'], color: PRIMARY },
        { key: '7-30d', label: '7–30 days', count: counts['7-30d'], color: WARN },
        { key: '>30d', label: '> 30 days', count: counts['>30d'], color: RISK }
      ];

      // Rows are already ordered oldest-first (created_at ascending), so the
      // first five active bugs are the five oldest still-open ones.
      const oldestFive: OldestBug[] = active.slice(0, 5).map(({ row, ageMs }) => ({
        id: row.display_id ?? `${row.application_id ?? 'none'}-${row.created_at}`,
        label: bugLabel(row),
        appName: (row.application_id && appNames.get(row.application_id)) || 'Unassigned',
        ageMs,
        isRisk: ageMs >= 30 * DAY_MS
      }));

      setBuckets(aggregated);
      setOldest(oldestFive);
      setActiveTotal(active.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBuckets(null);
      setOldest([]);
      setActiveTotal(0);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const riskCount = buckets?.find((b) => b.key === '>30d')?.count ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Aging — how long open bugs have waited</CardTitle>
        <AlarmClock className={`h-4 w-4 ${riskCount > 0 ? 'text-red-600' : 'text-blue-600'}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-red-600">
              Couldn&apos;t load the aging breakdown
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{error}</p>
          </div>
        ) : !buckets || activeTotal === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No open bugs waiting — every reported bug is resolved or closed. Nothing is aging.
          </p>
        ) : (
          <>
            {/* Stat row — exact counts per bucket, risk bucket in red. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {buckets.map((b) => (
                <div key={b.key} className="rounded-lg border p-3">
                  <div className="text-2xl font-bold tabular-nums" style={{ color: b.color }}>
                    {b.count}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">{b.label}</p>
                </div>
              ))}
            </div>

            {/* Bucket bar chart. */}
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={buckets} margin={{ top: 12, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="currentColor"
                    strokeOpacity={0.08}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
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
                    formatter={(value: number) => [`${value}`, 'Active bugs']}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={64}>
                    {buckets.map((b) => (
                      <Cell key={b.key} fill={b.color} />
                    ))}
                    <LabelList
                      dataKey="count"
                      position="top"
                      className="fill-foreground text-xs tabular-nums"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Oldest still-active bugs — the concrete backlog to chase. */}
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">Oldest still-open bugs</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bug</TableHead>
                      <TableHead>App</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {oldest.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="max-w-[220px] truncate font-medium">
                          {b.label}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{b.appName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.isRisk ? (
                            <span className="font-semibold" style={{ color: RISK }}>
                              {fmtAge(b.ageMs)}
                            </span>
                          ) : (
                            fmtAge(b.ageMs)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <p className="text-muted-foreground mt-3 text-xs tabular-nums">
              {activeTotal} {activeTotal === 1 ? 'bug is' : 'bugs are'} still open across all
              applications
              {riskCount > 0 ? (
                <>
                  {' '}
                  — <span style={{ color: RISK }}>{riskCount}</span> waiting more than 30 days.
                </>
              ) : (
                <> — none waiting more than 30 days.</>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
