'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus,
  ExternalLink,
  Bug,
  CheckCircle2,
  Clock,
  Settings,
  TrendingUp,
  Calendar
} from 'lucide-react';
import { useApplications } from '@/hooks/applications/use-applications';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { useManageableApplications } from '@/hooks/application-members/use-application-members';
import { ManageAccessDialog } from './_components/manage-access-dialog';

export default function ApplicationsPage() {
  const { organization, loading: orgLoading } = useOrganizationContext();
  const { applications, loading, error } = useApplications(
    organization?.id || ''
  );
  // Sharing an app requires super admin or app maintainer, both here and in
  // RLS --- hide the action rather than let the insert fail at the database.
  const { canManage } = useManageableApplications();

  if (orgLoading || loading) {
    return (
      <div className='space-y-8'>
        <div className='space-y-2'>
          <Skeleton className='h-10 w-64' />
          <Skeleton className='h-5 w-96' />
        </div>
        <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
          <Skeleton className='h-64' />
          <Skeleton className='h-64' />
          <Skeleton className='h-64' />
        </div>
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
              <div className='text-destructive'>Error loading applications</div>
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
          <h1 className='text-3xl font-bold tracking-tight'>Applications</h1>
          <p className='text-muted-foreground'>
            Manage and monitor applications for{' '}
            <span className='font-medium text-foreground'>
              {organization.name}
            </span>
          </p>
        </div>
        <Button
          asChild
          size='lg'
          className='w-full md:w-auto bg-linear-to-r from-blue-600 to-blue-700 text-white'
        >
          <Link href={`/org/${organization.slug}/apps/new`}>
            <Plus className='mr-2 h-5 w-5' />
            New Application
          </Link>
        </Button>
      </div>

      {/* Stats Overview */}
      {applications.length > 0 && (
        <div className='grid gap-4 md:grid-cols-3'>
          <Card className='border-l-4 border-l-primary'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Applications
              </CardTitle>
              <Bug className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold'>{applications.length}</div>
              <p className='text-xs text-muted-foreground mt-1'>
                Active projects
              </p>
            </CardContent>
          </Card>

          <Card className='border-l-4 border-l-green-500'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Bug Reports
              </CardTitle>
              <TrendingUp className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold'>
                {applications.reduce(
                  (acc, app) => acc + (app._stats?.total_bugs || 0),
                  0
                )}
              </div>
              <p className='text-xs text-muted-foreground mt-1'>
                Across all applications
              </p>
            </CardContent>
          </Card>

          <Card className='border-l-4 border-l-blue-500'>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Resolution Rate
              </CardTitle>
              <CheckCircle2 className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold'>
                {applications.reduce(
                  (acc, app) => acc + (app._stats?.total_bugs || 0),
                  0
                ) > 0
                  ? Math.round(
                      (applications.reduce(
                        (acc, app) => acc + (app._stats?.resolved_bugs || 0),
                        0
                      ) /
                        applications.reduce(
                          (acc, app) => acc + (app._stats?.total_bugs || 0),
                          0
                        )) *
                        100
                    )
                  : 0}
                %
              </div>
              <p className='text-xs text-muted-foreground mt-1'>
                Overall performance
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Applications Grid */}
      {applications.length === 0 ? (
        <Card className='border-dashed'>
          <CardContent className='flex flex-col items-center justify-center py-16'>
            <div className='rounded-full bg-muted p-4 mb-4'>
              <Bug className='h-8 w-8 text-muted-foreground' />
            </div>
            <h3 className='text-lg font-semibold mb-2'>No applications yet</h3>
            <p className='text-muted-foreground mb-6 text-center max-w-sm'>
              Get started by creating your first application to track and manage
              bug reports
            </p>
            <Button asChild size='lg'>
              <Link href={`/org/${organization.slug}/apps/new`}>
                <Plus className='mr-2 h-5 w-5' />
                Create Your First Application
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
          {applications.map((app) => {
            const totalBugs = app._stats?.total_bugs || 0;
            const resolvedBugs = app._stats?.resolved_bugs || 0;
            const pendingBugs = app._stats?.pending_bugs || 0;
            const resolutionRate =
              totalBugs > 0 ? Math.round((resolvedBugs / totalBugs) * 100) : 0;

            return (
              <Card
                key={app.id}
                className='group hover:shadow-lg transition-all duration-300 hover:border-primary/50'
              >
                <CardHeader className='space-y-3'>
                  <div className='flex items-start justify-between'>
                    <CardTitle className='text-xl group-hover:text-primary transition-colors'>
                      <Link
                        href={`/org/${organization.slug}/apps/${app.slug}`}
                        className='hover:underline'
                      >
                        {app.name}
                      </Link>
                    </CardTitle>
                    <Badge
                      variant={totalBugs > 0 ? 'default' : 'secondary'}
                      className='ml-2'
                    >
                      {totalBugs > 0 ? 'Active' : 'New'}
                    </Badge>
                  </div>
                  <CardDescription className='flex items-center gap-1 text-xs'>
                    <a
                      href={app.app_url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='hover:underline flex items-center gap-1 truncate group-hover:text-primary transition-colors'
                    >
                      <ExternalLink className='h-3 w-3 flex-shrink-0' />
                      <span className='truncate'>{app.app_url}</span>
                    </a>
                  </CardDescription>
                </CardHeader>

                <CardContent className='space-y-4'>
                  {/* Bug Stats */}
                  {app._stats && (
                    <div className='grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg'>
                      <div className='text-center space-y-1'>
                        <Bug className='h-4 w-4 mx-auto text-muted-foreground' />
                        <p className='text-2xl font-bold'>{totalBugs}</p>
                        <p className='text-xs text-muted-foreground'>Total</p>
                      </div>
                      <div className='text-center space-y-1'>
                        <CheckCircle2 className='h-4 w-4 mx-auto text-green-600' />
                        <p className='text-2xl font-bold text-green-600'>
                          {resolvedBugs}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          Resolved
                        </p>
                      </div>
                      <div className='text-center space-y-1'>
                        <Clock className='h-4 w-4 mx-auto text-orange-600' />
                        <p className='text-2xl font-bold text-orange-600'>
                          {pendingBugs}
                        </p>
                        <p className='text-xs text-muted-foreground'>Pending</p>
                      </div>
                    </div>
                  )}

                  {/* Meta Information */}
                  <div className='space-y-2 text-sm'>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground'>Slug</span>
                      <code className='px-2 py-1 bg-muted rounded text-xs font-mono'>
                        {app.slug}
                      </code>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground flex items-center gap-1'>
                        <Calendar className='h-3 w-3' />
                        Created
                      </span>
                      <span className='font-medium'>
                        {new Date(app.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                    {resolutionRate > 0 && (
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground'>
                          Resolution
                        </span>
                        <span className='font-medium'>{resolutionRate}%</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className='flex gap-2 pt-2'>
                    <Button
                      variant='default'
                      size='sm'
                      asChild
                      className='flex-1 bg-linear-to-r from-blue-600 to-blue-700 text-white'
                    >
                      <Link href={`/org/${organization.slug}/apps/${app.slug}`}>
                        View Details
                      </Link>
                    </Button>
                    {canManage(app.id) && (
                      <ManageAccessDialog
                        applicationId={app.id}
                        applicationName={app.name}
                      />
                    )}
                    <Button variant='outline' size='sm' asChild>
                      <Link
                        href={`/org/${organization.slug}/apps/${app.slug}/edit`}
                      >
                        <Settings className='h-4 w-4' />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
