'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Bug, BarChart3, Filter, RefreshCw } from 'lucide-react';
import {
  useBugReports,
  useBugStats
} from '@/hooks/bug-reports/use-bug-reports';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { useApplications } from '@/hooks/applications/use-applications';
import { BugReportsDataTable } from './_components/bug-reports-data-table';
import { BugStatsCards } from './_components/bug-stats-cards';
import toast from 'react-hot-toast';

export default function BugsPage() {
  const { organization, loading: orgLoading } = useOrganizationContext();
  const {
    bugs,
    loading,
    error,
    refetch: refetchBugs
  } = useBugReports(organization?.id || '');
  const {
    applications,
    loading: appsLoading,
    refetch: refetchApps
  } = useApplications(organization?.id || '');
  const {
    stats,
    loading: statsLoading,
    refetch: refetchStats
  } = useBugStats(organization?.id || '');

  const handleRefresh = async () => {
    toast.loading('Refreshing data...', { id: 'refresh-bugs' });
    await Promise.all([refetchBugs(), refetchStats(), refetchApps()]);
    toast.success('Data refreshed!', { id: 'refresh-bugs' });
  };

  if (orgLoading || loading) {
    return (
      <div className='space-y-8'>
        <div className='space-y-2'>
          <Skeleton className='h-10 w-64' />
          <Skeleton className='h-5 w-96' />
        </div>
        <div className='grid gap-4 md:grid-cols-3'>
          <Skeleton className='h-32' />
          <Skeleton className='h-32' />
          <Skeleton className='h-32' />
        </div>
        <Skeleton className='h-96' />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Card className='w-full max-w-md'>
          <CardContent className='pt-6'>
            <div className='text-center space-y-2'>
              <Bug className='mx-auto h-12 w-12 text-muted-foreground' />
              <h3 className='font-semibold'>Organization Not Found</h3>
              <p className='text-sm text-muted-foreground'>
                The organization you&apos;re looking for doesn&apos;t exist.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Card className='w-full max-w-md border-destructive'>
          <CardContent className='pt-6'>
            <div className='text-center space-y-2'>
              <div className='text-destructive'>Error loading bug reports</div>
              <p className='text-sm text-muted-foreground'>{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className='space-y-8'>
      {/* Header Section */}
      <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div className='space-y-1'>
          <h1 className='text-3xl font-bold tracking-tight'>Bug Reports</h1>
          <p className='text-muted-foreground'>
            Track and manage all bug reports for{' '}
            <span className='font-medium text-foreground'>
              {organization.name}
            </span>
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            onClick={handleRefresh}
            disabled={loading || statsLoading || appsLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                loading || statsLoading || appsLoading ? 'animate-spin' : ''
              }`}
            />
            Refresh
          </Button>
          <Button variant='outline' asChild>
            <Link href={`/org/${organization.slug}/apps`}>
              <Filter className='mr-2 h-4 w-4' />
              Applications
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/org/${organization.slug}/bugs/dashboard`}>
              <BarChart3 className='mr-2 h-4 w-4' />
              Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {bugs.length > 0 && (
        <BugStatsCards stats={stats} loading={statsLoading} />
      )}

      {/* Main Content */}
      {bugs.length === 0 ? (
        <Card className='border-dashed'>
          <CardContent className='flex flex-col items-center justify-center py-16'>
            <div className='rounded-full bg-muted p-4 mb-4'>
              <Bug className='h-8 w-8 text-muted-foreground' />
            </div>
            <h3 className='text-lg font-semibold mb-2'>No bug reports yet</h3>
            <p className='text-muted-foreground mb-6 text-center max-w-sm'>
              Bug reports will appear here when users submit them through the
              SDK integrated in your applications
            </p>
            <Button asChild>
              <Link href={`/org/${organization.slug}/apps`}>
                View Applications
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <BugReportsDataTable
          data={bugs}
          organizationSlug={organization.slug}
          applications={applications}
          applicationsLoading={appsLoading}
          onStatusChange={() => { refetchBugs(); refetchStats(); }}
        />
      )}
    </div>
  );
}
