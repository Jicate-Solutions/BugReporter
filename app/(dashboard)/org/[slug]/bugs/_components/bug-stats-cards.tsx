'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bug, Clock, CheckCircle2, Eye, FileX, Sparkles } from 'lucide-react';
import type { BugReportStats } from '@boobalan_jkkn/shared';
import { BUG_STATUS_LABELS } from '@boobalan_jkkn/shared';

interface BugStatsCardsProps {
  stats: BugReportStats | null;
  loading?: boolean;
}

export function BugStatsCards({ stats, loading }: BugStatsCardsProps) {
  if (loading) return <div>Loading stats...</div>;
  if (!stats) return null;

  // One card per real status. This used to read `by_status.open` and
  // `by_status.closed` — values the database has never produced — so the Open
  // and Closed cards showed 0 while New and Won't Fix bugs went uncounted.
  const cards = [
    {
      title: 'Total Bugs',
      value: stats.total,
      icon: Bug,
      color: 'text-blue-600',
    },
    {
      title: BUG_STATUS_LABELS.new,
      value: stats.by_status.new,
      icon: Sparkles,
      color: 'text-blue-600',
    },
    {
      title: BUG_STATUS_LABELS.seen,
      value: stats.by_status.seen,
      icon: Eye,
      color: 'text-amber-600',
    },
    {
      title: BUG_STATUS_LABELS.in_progress,
      value: stats.by_status.in_progress,
      icon: Clock,
      color: 'text-orange-600',
    },
    {
      title: BUG_STATUS_LABELS.resolved,
      value: stats.by_status.resolved,
      icon: CheckCircle2,
      color: 'text-green-600',
    },
    {
      title: BUG_STATUS_LABELS.wont_fix,
      value: stats.by_status.wont_fix,
      icon: FileX,
      color: 'text-gray-600',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
