import { ApplicationServerService } from '@/lib/services/applications/server';
import { OrganizationServerService } from '@/lib/services/organizations/server';
import { BugReportServerService } from '@/lib/services/bug-reports/server';
import { BugStatusBadge } from '../../bugs/_components/bug-status-badge';
import { notFound } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { ApplicationStats } from '../_components/application-stats';
import { ApiKeyDisplay } from '../_components/api-key-display';
import {
  ExternalLink,
  Settings,
  Bug,
  Calendar,
  Globe,
  Hash,
  Shield,
  ArrowLeft,
  FileText,
  AlertCircle
} from 'lucide-react';

interface ApplicationPageProps {
  params: Promise<{
    slug: string;
    appSlug: string;
  }>;
}

export default async function ApplicationPage({
  params
}: ApplicationPageProps) {
  const { slug, appSlug } = await params;

  const organization = await OrganizationServerService.getOrganizationBySlug(
    slug
  );

  if (!organization) {
    notFound();
  }

  const application = await ApplicationServerService.getApplicationBySlug(
    organization.id,
    appSlug
  );

  if (!application) {
    notFound();
  }

  const stats = await ApplicationServerService.getApplicationStats(
    application.id
  );

  const recentBugs = await BugReportServerService.getRecentByApplication(
    application.id,
    5
  );

  return (
    <div className='space-y-8'>
      {/* Breadcrumb & Header */}
      <div className='space-y-4'>
        <Button variant='ghost' size='sm' asChild className='gap-2'>
          <Link href={`/org/${slug}/apps`}>
            <ArrowLeft className='h-4 w-4' />
            Back to Applications
          </Link>
        </Button>

        <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
          <div className='space-y-2'>
            <div className='flex items-center gap-3'>
              <div className='rounded-lg bg-primary/10 p-3'>
                <Bug className='h-6 w-6 text-primary' />
              </div>
              <div>
                <h1 className='text-3xl font-bold tracking-tight'>
                  {application.name}
                </h1>
                <p className='text-muted-foreground'>
                  Application in{' '}
                  <span className='font-medium text-foreground'>
                    {organization.name}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' asChild>
              <Link href={`/org/${slug}/bugs?app=${appSlug}`}>
                <FileText className='mr-2 h-4 w-4' />
                View Bug Reports
              </Link>
            </Button>
            <Button
              asChild
              className='bg-linear-to-r from-blue-600 to-blue-700 text-white'
            >
              <Link href={`/org/${slug}/apps/${appSlug}/edit`}>
                <Settings className='mr-2 h-4 w-4' />
                Settings
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <ApplicationStats stats={stats} />

      <div className='grid gap-6 lg:grid-cols-2'>
        {/* Application Information */}
        <Card className='border-l-4 border-l-primary'>
          <CardHeader>
            <div className='flex items-center gap-2'>
              <div className='rounded-md bg-primary/10 p-2'>
                <AlertCircle className='h-4 w-4 text-primary' />
              </div>
              <div>
                <CardTitle>Application Information</CardTitle>
                <CardDescription>
                  Basic details and configuration
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-6'>
            {/* Name */}
            <div className='space-y-2'>
              <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                <FileText className='h-4 w-4' />
                Application Name
              </div>
              <p className='text-base font-semibold'>{application.name}</p>
            </div>

            <Separator />

            {/* Slug */}
            <div className='space-y-2'>
              <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                <Hash className='h-4 w-4' />
                Slug
              </div>
              <code className='block rounded-md bg-muted px-3 py-2 text-sm font-mono'>
                {application.slug}
              </code>
            </div>

            <Separator />

            {/* URL */}
            <div className='space-y-2'>
              <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                <Globe className='h-4 w-4' />
                Application URL
              </div>
              <a
                href={application.app_url}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-2 text-sm text-primary hover:underline hover:text-primary/80 transition-colors'
              >
                <span className='break-all'>{application.app_url}</span>
                <ExternalLink className='h-4 w-4 flex-shrink-0' />
              </a>
            </div>

            <Separator />

            {/* Created Date */}
            <div className='space-y-2'>
              <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                <Calendar className='h-4 w-4' />
                Created On
              </div>
              <p className='text-sm font-medium'>
                {new Date(application.created_at).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            </div>

            {/* Allowed Domains */}
            {application.settings?.allowed_domains &&
              application.settings.allowed_domains.length > 0 && (
                <>
                  <Separator />
                  <div className='space-y-3'>
                    <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                      <Shield className='h-4 w-4' />
                      Allowed Domains
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {application.settings.allowed_domains.map((domain) => (
                        <Badge
                          key={domain}
                          variant='secondary'
                          className='px-3 py-1'
                        >
                          {domain}
                        </Badge>
                      ))}
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      Bug reports will only be accepted from these domains
                    </p>
                  </div>
                </>
              )}
          </CardContent>
        </Card>

        {/* API Configuration */}
        <div className='space-y-6'>
          <Card className='border-l-4 border-l-blue-500'>
            <CardHeader>
              <div className='flex items-center gap-2'>
                <div className='rounded-md bg-blue-500/10 p-2'>
                  <Shield className='h-4 w-4 text-blue-600' />
                </div>
                <div>
                  <CardTitle>API Configuration</CardTitle>
                  <CardDescription>SDK integration credentials</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ApiKeyDisplay apiKey={application.api_key} />

              <div className='mt-6 rounded-lg bg-blue-50 dark:bg-blue-950/20 p-4 border border-blue-200 dark:border-blue-900'>
                <h4 className='text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2'>
                  SDK Integration
                </h4>
                <p className='text-xs text-blue-800 dark:text-blue-200 mb-3'>
                  Use this API key to integrate the bug reporter SDK into your
                  application:
                </p>
                <code className='block bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 p-3 rounded text-xs overflow-x-auto'>
                  {`<BugReporterProvider
  apiKey="${application.api_key}"
  apiUrl="https://your-platform.com"
>`}
                </code>
              </div>
            </CardContent>
          </Card>

          {/* Recent Bug Reports */}
          <Card className='border-l-4 border-l-orange-500'>
            <CardHeader>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <div className='rounded-md bg-orange-500/10 p-2'>
                    <Bug className='h-4 w-4 text-orange-600' />
                  </div>
                  <div>
                    <CardTitle>Recent Bug Reports</CardTitle>
                    <CardDescription>
                      Latest {recentBugs.length} of {stats.total_bugs} reports
                    </CardDescription>
                  </div>
                </div>
                {stats.total_bugs > recentBugs.length && (
                  <Button variant='ghost' size='sm' asChild>
                    <Link href={`/org/${slug}/bugs?app=${appSlug}`}>
                      View all
                    </Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className='space-y-2'>
              {recentBugs.length === 0 ? (
                <p className='text-sm text-muted-foreground py-6 text-center'>
                  No bug reports yet for this application.
                </p>
              ) : (
                recentBugs.map((bug) => (
                  <Link
                    key={bug.id}
                    href={`/org/${slug}/bugs/${bug.id}`}
                    className='flex items-start justify-between gap-3 rounded-md border p-3 hover:bg-muted/50 transition-colors'
                  >
                    <div className='min-w-0 flex-1 space-y-1'>
                      <div className='flex items-center gap-2'>
                        <span className='text-xs font-mono text-muted-foreground'>
                          {(bug as { display_id?: string }).display_id ||
                            `#${bug.id.slice(0, 8)}`}
                        </span>
                        <BugStatusBadge status={bug.status} />
                      </div>
                      <div className='font-medium text-sm truncate'>
                        {bug.title || 'Untitled'}
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        {new Date(bug.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Auto-Triage Substrate */}
          <Card className='border-l-4 border-l-purple-500'>
            <CardHeader>
              <div className='flex items-center gap-2'>
                <div className='rounded-md bg-purple-500/10 p-2'>
                  <Settings className='h-4 w-4 text-purple-600' />
                </div>
                <div>
                  <CardTitle>Auto-Triage Substrate</CardTitle>
                  <CardDescription>
                    Config the auto-triage agent uses to fix bugs end-to-end
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                  <Hash className='h-4 w-4' />
                  GitHub Repository
                </div>
                {application.settings?.github_repo ? (
                  <a
                    href={`https://github.com/${application.settings.github_repo}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-2 text-sm text-primary hover:underline'
                  >
                    <code className='font-mono'>
                      {application.settings.github_repo}
                    </code>
                    <ExternalLink className='h-3.5 w-3.5 flex-shrink-0' />
                  </a>
                ) : (
                  <p className='text-sm text-muted-foreground italic'>
                    Not set — agent cannot open fix PRs for this app yet
                  </p>
                )}
              </div>

              <Separator />

              <div className='space-y-2'>
                <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                  <Globe className='h-4 w-4' />
                  Vercel Deploy Hook
                </div>
                {application.settings?.deploy_hook_url ? (
                  <Badge variant='secondary' className='font-mono text-xs'>
                    Configured
                  </Badge>
                ) : (
                  <p className='text-sm text-muted-foreground italic'>
                    Not set — agent cannot ship merged fixes
                  </p>
                )}
              </div>

              <Separator />

              <div className='space-y-2'>
                <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                  <Shield className='h-4 w-4' />
                  Test Credentials Note
                </div>
                {application.settings?.test_credentials_note ? (
                  <p className='text-sm font-mono bg-muted px-2 py-1 rounded'>
                    {application.settings.test_credentials_note}
                  </p>
                ) : (
                  <p className='text-sm text-muted-foreground italic'>
                    Not set — agent will skip CFT verification for this app
                  </p>
                )}
              </div>

              <Separator />

              <div className='space-y-2'>
                <div className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                  <Shield className='h-4 w-4' />
                  Auto-Merge Policy
                </div>
                {application.settings?.auto_triage_policy
                  ?.auto_merge_eligible ? (
                  <Badge className='bg-amber-500 hover:bg-amber-500 text-white'>
                    Auto-merge enabled (danger zones still gated)
                  </Badge>
                ) : (
                  <Badge variant='secondary'>
                    Manual review required for every fix (default)
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions Card */}
          <Card className='border-l-4 border-l-green-500'>
            <CardHeader>
              <div className='flex items-center gap-2'>
                <div className='rounded-md bg-green-500/10 p-2'>
                  <Bug className='h-4 w-4 text-green-600' />
                </div>
                <div>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>Common tasks and operations</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className='grid gap-3'>
              <Button
                variant='outline'
                className='w-full justify-start h-auto py-3'
                asChild
              >
                <Link href={`/org/${slug}/bugs?app=${appSlug}`}>
                  <div className='flex items-start gap-3 text-left'>
                    <FileText className='h-5 w-5 mt-0.5 text-primary' />
                    <div className='flex-1'>
                      <div className='font-semibold'>View All Bug Reports</div>
                      <div className='text-xs text-muted-foreground'>
                        Browse and manage reported bugs
                      </div>
                    </div>
                  </div>
                </Link>
              </Button>

              <Button
                variant='outline'
                className='w-full justify-start h-auto py-3'
                asChild
              >
                <Link href={`/org/${slug}/apps/${appSlug}/edit`}>
                  <div className='flex items-start gap-3 text-left'>
                    <Settings className='h-5 w-5 mt-0.5 text-primary' />
                    <div className='flex-1'>
                      <div className='font-semibold'>Edit Settings</div>
                      <div className='text-xs text-muted-foreground'>
                        Configure domains and preferences
                      </div>
                    </div>
                  </div>
                </Link>
              </Button>

              <Button
                variant='outline'
                className='w-full justify-start h-auto py-3'
                asChild
              >
                <a
                  href={application.app_url}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <div className='flex items-start gap-3 text-left'>
                    <ExternalLink className='h-5 w-5 mt-0.5 text-primary' />
                    <div className='flex-1'>
                      <div className='font-semibold'>Visit Application</div>
                      <div className='text-xs text-muted-foreground'>
                        Open application in new tab
                      </div>
                    </div>
                  </div>
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
