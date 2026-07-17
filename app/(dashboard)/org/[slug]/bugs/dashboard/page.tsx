'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { List, RefreshCw } from 'lucide-react';
import { useBugStats, useFleetBugRollup } from '@/hooks/bug-reports/use-bug-reports';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { BugStatsCards } from '../_components/bug-stats-cards';
import { BugRollupByApp } from '../_components/bug-rollup-by-app';
import { CategoryBreakdownCard } from '../_components/rollups/category-breakdown-card';
import { ThroughputTrendCard } from '../_components/rollups/throughput-trend-card';
import { AgingRiskCard } from '../_components/rollups/aging-risk-card';
import { SecuritySpotlightCard } from '../_components/rollups/security-spotlight-card';
import { ResolutionTimeCard } from '../_components/rollups/resolution-time-card';
import { AiFleetBriefingCard } from '../_components/rollups/ai-fleet-briefing-card';
import { AiTriageHelperCard } from '../_components/rollups/ai-triage-helper-card';
import { AiDuplicateFinderCard } from '../_components/rollups/ai-duplicate-finder-card';
import { Skeleton } from '@/components/ui/skeleton';
import toast from 'react-hot-toast';

export default function BugDashboardPage() {
  const { organization, loading: orgLoading } = useOrganizationContext();
  const { stats, loading, refetch } = useBugStats(organization?.id || '');
  const {
    rollup,
    loading: rollupLoading,
    error: rollupError,
    refetch: refetchRollup
  } = useFleetBugRollup(organization?.id || '');

  const handleRefresh = async () => {
    toast.loading('Refreshing data...', { id: 'refresh-dashboard' });
    const [statsOk, rollupOk] = await Promise.all([refetch(), refetchRollup()]);
    if (statsOk && rollupOk) {
      toast.success('Data refreshed!', { id: 'refresh-dashboard' });
    } else {
      toast.error('Some data failed to refresh', { id: 'refresh-dashboard' });
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 md:grid-cols-5">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!organization) {
    return <div>Organization not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Bug Reports Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of bug reports for {organization.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href={`/org/${organization.slug}/bugs`}>
              <List className="mr-2 h-4 w-4" />
              View All Bugs
            </Link>
          </Button>
        </div>
      </div>

      <BugStatsCards stats={stats} loading={loading} />

      {stats && stats.total === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No bug reports yet. Statistics will appear here when users submit bug reports through
            the SDK.
          </p>
        </div>
      )}

      <div className="border-t pt-6">
        <AiFleetBriefingCard organizationId={organization.id} />
      </div>

      <div className="border-t pt-6">
        <BugRollupByApp
          rollup={rollup}
          loading={rollupLoading}
          error={rollupError}
          orgSlug={organization.slug}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <ThroughputTrendCard organizationId={organization.id} />
        </div>
        <CategoryBreakdownCard organizationId={organization.id} />
        <ResolutionTimeCard organizationId={organization.id} />
        <AgingRiskCard organizationId={organization.id} />
        <SecuritySpotlightCard organizationId={organization.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AiTriageHelperCard organizationId={organization.id} />
        <AiDuplicateFinderCard organizationId={organization.id} />
      </div>
    </div>
  );
}
