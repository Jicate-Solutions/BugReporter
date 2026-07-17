'use client';

/**
 * Cross-app bug rollup (Phase 3 of the Control Tower).
 *
 * The flat dashboard collapses every app's bugs into one org total. This
 * section restores the dimension the data always had — `application_id` —
 * and answers the operator's real questions: which app is noisiest, where
 * are criticals still open, how fast do bugs get resolved per app, and is the
 * fleet's bug intake trending up or down. Purely a new read; no schema change.
 */

import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { AppWindow, Bug, ShieldAlert, CalendarPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { FleetBugRollup } from '@/lib/services/bug-reports/client';

interface Props {
  rollup: FleetBugRollup | null;
  loading?: boolean;
  orgSlug: string;
}

/** Human-friendly time-to-resolve from hours. */
function fmtResolve(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export function BugRollupByApp({ rollup, loading, orgSlug }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-52" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!rollup) return null;

  const { apps, trend, totals } = rollup;
  const realApps = apps.filter((a) => a.application_id !== '__unassigned__');
  const noisiest = realApps.find((a) => a.total > 0) ?? null;
  const trendPeak = Math.max(1, ...trend.map((t) => t.count));

  if (totals.totalApps === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          No applications registered yet. Once apps report bugs through the SDK, their
          cross-app rollup appears here.
        </CardContent>
      </Card>
    );
  }

  const summary = [
    {
      title: 'Apps reporting',
      value: `${totals.appsReporting}`,
      sub: `of ${totals.totalApps} registered`,
      icon: AppWindow,
      tone: 'text-blue-600'
    },
    {
      title: 'Open across fleet',
      value: `${totals.open}`,
      sub: 'open + in progress',
      icon: Bug,
      tone: totals.open > 0 ? 'text-purple-600' : 'text-muted-foreground'
    },
    {
      title: 'Security bugs open',
      value: `${totals.securityOpen}`,
      sub: 'still active',
      icon: ShieldAlert,
      tone: totals.securityOpen > 0 ? 'text-red-600' : 'text-green-600'
    },
    {
      title: 'New this week',
      value: `${totals.newThisWeek}`,
      sub: 'last 7 days',
      icon: CalendarPlus,
      tone: 'text-amber-600'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Cross-app rollup</h2>
        <p className="text-muted-foreground text-sm">
          Every registered app&apos;s bug load in one view — noisiest first
          {noisiest ? (
            <>
              {' '}
              (currently <span className="font-medium">{noisiest.name}</span> with{' '}
              {noisiest.total})
            </>
          ) : null}
          .
        </p>
      </div>

      {/* Fleet summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {summary.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
              <p className="text-muted-foreground mt-1 text-xs">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Fleet trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New bugs — last 14 days (whole fleet)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="bugTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                width={28}
                tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
                tickLine={false}
                axisLine={false}
                domain={[0, trendPeak <= 4 ? 4 : 'auto']}
              />
              <Tooltip
                cursor={{ stroke: '#3b82f6', strokeOpacity: 0.25 }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid rgba(120,120,120,0.25)'
                }}
                labelStyle={{ fontWeight: 600 }}
                formatter={(v: number) => [`${v} new`, 'Bugs']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#bugTrendFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-app table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By application</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">In progress</TableHead>
                  <TableHead className="text-right">Resolved</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead className="text-right">New 7d</TableHead>
                  <TableHead className="text-right">Median resolve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((a) => {
                  const isUnassigned = a.application_id === '__unassigned__';
                  return (
                    <TableRow key={a.application_id}>
                      <TableCell>
                        {isUnassigned ? (
                          <span className="text-muted-foreground font-medium italic">
                            {a.name}
                          </span>
                        ) : (
                          <Link
                            href={`/org/${orgSlug}/apps/${a.slug}`}
                            className="font-medium hover:underline"
                          >
                            {a.name}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {a.total}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.open > 0 ? (
                          <span className="text-amber-600 font-medium">{a.open}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {a.in_progress}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.resolved > 0 ? (
                          <span className="text-green-600">{a.resolved}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.security > 0 ? (
                          <Badge variant="destructive" className="tabular-nums">
                            {a.security} security
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.last7 > 0 ? a.last7 : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {fmtResolve(a.medianResolveHours)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            &quot;Open&quot; counts new + seen bugs (not yet in progress).
            &quot;Security&quot; flags bugs filed under the security category.
            &quot;Median resolve&quot; is the typical time from report to resolved, per app —
            a dash means nothing resolved yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
