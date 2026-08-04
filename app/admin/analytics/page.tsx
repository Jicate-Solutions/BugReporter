'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Bug,
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Building2,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { BUG_STATUS_BADGE_CLASS, isBugStatus } from '@boobalan_jkkn/shared';

interface AnalyticsStats {
  totalBugReports: number;
  openBugs: number;
  inProgressBugs: number;
  resolvedBugs: number;
  closedBugs: number;
  totalOrganizations: number;
  totalApplications: number;
  recentBugs: number;
}

interface OrganizationStats {
  id: string;
  name: string;
  bugCount: number;
  openCount: number;
  resolvedCount: number;
}

interface RecentBugReport {
  id: string;
  title: string;
  status: string;
  severity: string;
  created_at: string;
  application: {
    name: string;
  };
  organization: {
    name: string;
  };
}

interface BugReportQueryResult {
  id: string;
  title: string;
  status: string;
  severity: string;
  created_at: string;
  applications: { name: string } | { name: string }[];
  organizations: { name: string } | { name: string }[];
}

/**
 * Platform Analytics Page (Super Admin Only)
 * View platform-wide statistics and trends
 */
export default function AnalyticsPage() {
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [orgStats, setOrgStats] = useState<OrganizationStats[]>([]);
  const [recentBugs, setRecentBugs] = useState<RecentBugReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const supabase = createClient();

        // Fetch overall stats
        const [
          { count: totalBugs },
          { count: openBugs },
          { count: inProgressBugs },
          { count: resolvedBugs },
          { count: closedBugs },
          { count: orgCount },
          { count: appCount }
        ] = await Promise.all([
          supabase
            .from('bug_reports')
            .select('*', { count: 'exact', head: true }),
          // "Open" = reported but not yet being worked on. This queried
          // status = 'open', a value the database has never stored, so the
          // Open card read 0 on every deployment.
          supabase
            .from('bug_reports')
            .select('*', { count: 'exact', head: true })
            .in('status', ['new', 'seen']),
          supabase
            .from('bug_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'in_progress'),
          supabase
            .from('bug_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'resolved'),
          // Same problem: 'closed' was never a real status. The terminal
          // non-fixed status is 'wont_fix'.
          supabase
            .from('bug_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'wont_fix'),
          supabase
            .from('organizations')
            .select('*', { count: 'exact', head: true }),
          supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
        ]);

        // Get recent bugs (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { count: recentCount } = await supabase
          .from('bug_reports')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo.toISOString());

        setStats({
          totalBugReports: totalBugs || 0,
          openBugs: openBugs || 0,
          inProgressBugs: inProgressBugs || 0,
          resolvedBugs: resolvedBugs || 0,
          closedBugs: closedBugs || 0,
          totalOrganizations: orgCount || 0,
          totalApplications: appCount || 0,
          recentBugs: recentCount || 0
        });

        // Fetch organization-level stats
        const { data: organizations } = await supabase
          .from('organizations')
          .select('id, name');

        if (organizations) {
          const orgStatsPromises = organizations.map(async (org) => {
            const [
              { count: totalCount },
              { count: openCount },
              { count: resolvedCount }
            ] = await Promise.all([
              supabase
                .from('bug_reports')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', org.id),
              supabase
                .from('bug_reports')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', org.id)
                .in('status', ['new', 'seen']),
              supabase
                .from('bug_reports')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', org.id)
                .eq('status', 'resolved')
            ]);

            return {
              id: org.id,
              name: org.name,
              bugCount: totalCount || 0,
              openCount: openCount || 0,
              resolvedCount: resolvedCount || 0
            };
          });

          const orgStatsData = await Promise.all(orgStatsPromises);
          setOrgStats(orgStatsData.sort((a, b) => b.bugCount - a.bugCount));
        }

        // Fetch recent bug reports
        const { data: recentBugsData } = await supabase
          .from('bug_reports')
          .select(
            `
            id,
            title,
            status,
            severity,
            created_at,
            applications!inner (
              name
            ),
            organizations!inner (
              name
            )
          `
          )
          .order('created_at', { ascending: false })
          .limit(10);

        if (recentBugsData) {
          setRecentBugs(
            recentBugsData.map((bug: BugReportQueryResult) => ({
              id: bug.id,
              title: bug.title,
              status: bug.status,
              severity: bug.severity,
              created_at: bug.created_at,
              application: {
                name: Array.isArray(bug.applications)
                  ? bug.applications[0]?.name || 'Unknown'
                  : bug.applications?.name || 'Unknown'
              },
              organization: {
                name: Array.isArray(bug.organizations)
                  ? bug.organizations[0]?.name || 'Unknown'
                  : bug.organizations?.name || 'Unknown'
              }
            }))
          );
        }
      } catch (error) {
        console.error('[Analytics Page] Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  const getStatusColor = (status: string) =>
    isBugStatus(status)
      ? BUG_STATUS_BADGE_CLASS[status]
      : 'border-gray-300 text-gray-700 bg-gray-50';

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-red-300 text-red-700 bg-red-50';
      case 'high':
        return 'border-orange-300 text-orange-700 bg-orange-50';
      case 'medium':
        return 'border-yellow-300 text-yellow-700 bg-yellow-50';
      case 'low':
        return 'border-blue-300 text-blue-700 bg-blue-50';
      default:
        return 'border-gray-300 text-gray-700 bg-gray-50';
    }
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-orange-50 via-white to-purple-50'>
      <div className='max-w-7xl mx-auto p-6 space-y-8'>
        {/* Header */}
        <div className='space-y-4'>
          <Link href='/admin/dashboard'>
            <Button variant='ghost' className='gap-2'>
              <ArrowLeft className='h-4 w-4' />
              Back to Dashboard
            </Button>
          </Link>

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='p-3 bg-gradient-to-br from-orange-600 to-orange-800 rounded-xl shadow-lg'>
                <BarChart3 className='h-6 w-6 text-white' />
              </div>
              <div>
                <h1 className='text-3xl font-bold text-gray-900'>
                  Platform Analytics
                </h1>
                <p className='text-gray-600'>
                  Monitor bug reports and platform-wide statistics
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-6'>
          <Card className='border-2 hover:shadow-lg transition-shadow bg-gradient-to-br from-orange-50 to-white'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-sm font-medium text-gray-600'>
                  Total Bug Reports
                </CardTitle>
                <Bug className='h-4 w-4 text-orange-600' />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className='h-8 w-8 animate-spin text-orange-600' />
              ) : (
                <>
                  <div className='text-3xl font-bold text-orange-600'>
                    {stats?.totalBugReports || 0}
                  </div>
                  <p className='text-xs text-gray-500 mt-1 flex items-center gap-1'>
                    <TrendingUp className='h-3 w-3 text-green-600' />
                    {stats?.recentBugs || 0} this week
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className='border-2 hover:shadow-lg transition-shadow bg-gradient-to-br from-blue-50 to-white'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-sm font-medium text-gray-600'>
                  Organizations
                </CardTitle>
                <Building2 className='h-4 w-4 text-blue-600' />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className='h-8 w-8 animate-spin text-blue-600' />
              ) : (
                <div className='text-3xl font-bold text-blue-600'>
                  {stats?.totalOrganizations || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className='border-2 hover:shadow-lg transition-shadow bg-gradient-to-br from-purple-50 to-white'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-sm font-medium text-gray-600'>
                  Applications
                </CardTitle>
                <Users className='h-4 w-4 text-purple-600' />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className='h-8 w-8 animate-spin text-purple-600' />
              ) : (
                <div className='text-3xl font-bold text-purple-600'>
                  {stats?.totalApplications || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className='border-2 hover:shadow-lg transition-shadow bg-gradient-to-br from-green-50 to-white'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-sm font-medium text-gray-600'>
                  Resolution Rate
                </CardTitle>
                <CheckCircle2 className='h-4 w-4 text-green-600' />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className='h-8 w-8 animate-spin text-green-600' />
              ) : (
                <>
                  <div className='text-3xl font-bold text-green-600'>
                    {stats?.totalBugReports
                      ? Math.round(
                          ((stats.resolvedBugs + stats.closedBugs) /
                            stats.totalBugReports) *
                            100
                        )
                      : 0}
                    %
                  </div>
                  <p className='text-xs text-gray-500 mt-1'>
                    {(stats?.resolvedBugs || 0) + (stats?.closedBugs || 0)}{' '}
                    resolved
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bug Status Breakdown */}
        <Card className='border-2 shadow-lg'>
          <CardHeader>
            <CardTitle>Bug Status Distribution</CardTitle>
            <CardDescription>
              Current status of all bug reports across the platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='h-6 w-6 animate-spin text-gray-400' />
              </div>
            ) : (
              <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
                <div className='p-4 border-2 rounded-lg bg-orange-50 border-orange-200'>
                  <div className='flex items-center gap-2 mb-2'>
                    <AlertCircle className='h-5 w-5 text-orange-600' />
                    <span className='font-semibold text-orange-900'>Open</span>
                  </div>
                  <div className='text-3xl font-bold text-orange-600'>
                    {stats?.openBugs || 0}
                  </div>
                </div>

                <div className='p-4 border-2 rounded-lg bg-blue-50 border-blue-200'>
                  <div className='flex items-center gap-2 mb-2'>
                    <Clock className='h-5 w-5 text-blue-600' />
                    <span className='font-semibold text-blue-900'>
                      In Progress
                    </span>
                  </div>
                  <div className='text-3xl font-bold text-blue-600'>
                    {stats?.inProgressBugs || 0}
                  </div>
                </div>

                <div className='p-4 border-2 rounded-lg bg-green-50 border-green-200'>
                  <div className='flex items-center gap-2 mb-2'>
                    <CheckCircle2 className='h-5 w-5 text-green-600' />
                    <span className='font-semibold text-green-900'>
                      Resolved
                    </span>
                  </div>
                  <div className='text-3xl font-bold text-green-600'>
                    {stats?.resolvedBugs || 0}
                  </div>
                </div>

                <div className='p-4 border-2 rounded-lg bg-gray-50 border-gray-200'>
                  <div className='flex items-center gap-2 mb-2'>
                    <XCircle className='h-5 w-5 text-gray-600' />
                    <span className='font-semibold text-gray-900'>Closed</span>
                  </div>
                  <div className='text-3xl font-bold text-gray-600'>
                    {stats?.closedBugs || 0}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
          {/* Organization Stats */}
          <Card className='border-2 shadow-lg'>
            <CardHeader>
              <CardTitle>Top Organizations</CardTitle>
              <CardDescription>
                Bug report activity by organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className='flex items-center justify-center py-8'>
                  <Loader2 className='h-6 w-6 animate-spin text-gray-400' />
                </div>
              ) : orgStats.length === 0 ? (
                <div className='text-center py-8 text-gray-500'>
                  <Building2 className='h-12 w-12 mx-auto mb-3 text-gray-300' />
                  <p>No organizations found</p>
                </div>
              ) : (
                <div className='space-y-3'>
                  {orgStats.slice(0, 5).map((org) => (
                    <div
                      key={org.id}
                      className='flex items-center justify-between p-3 bg-gray-50 rounded-lg border'
                    >
                      <div className='flex-1'>
                        <div className='font-medium text-gray-900'>
                          {org.name}
                        </div>
                        <div className='text-sm text-gray-500'>
                          {org.bugCount} total bugs
                        </div>
                      </div>
                      <div className='flex gap-2'>
                        <Badge
                          variant='outline'
                          className='border-orange-300 text-orange-700 bg-orange-50'
                        >
                          {org.openCount} open
                        </Badge>
                        <Badge
                          variant='outline'
                          className='border-green-300 text-green-700 bg-green-50'
                        >
                          {org.resolvedCount} resolved
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Bug Reports */}
          <Card className='border-2 shadow-lg'>
            <CardHeader>
              <CardTitle>Recent Bug Reports</CardTitle>
              <CardDescription>
                Latest bug reports across all applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className='flex items-center justify-center py-8'>
                  <Loader2 className='h-6 w-6 animate-spin text-gray-400' />
                </div>
              ) : recentBugs.length === 0 ? (
                <div className='text-center py-8 text-gray-500'>
                  <Bug className='h-12 w-12 mx-auto mb-3 text-gray-300' />
                  <p>No bug reports found</p>
                </div>
              ) : (
                <div className='space-y-3 max-h-96 overflow-y-auto'>
                  {recentBugs.map((bug) => (
                    <div
                      key={bug.id}
                      className='p-3 bg-gray-50 rounded-lg border space-y-2'
                    >
                      <div className='font-medium text-gray-900 line-clamp-1'>
                        {bug.title}
                      </div>
                      <div className='flex flex-wrap gap-2'>
                        <Badge
                          variant='outline'
                          className={getStatusColor(bug.status)}
                        >
                          {bug.status}
                        </Badge>
                        <Badge
                          variant='outline'
                          className={getSeverityColor(bug.severity)}
                        >
                          {bug.severity}
                        </Badge>
                      </div>
                      <div className='text-xs text-gray-500'>
                        {bug.organization.name} • {bug.application.name} •{' '}
                        {formatDistanceToNow(new Date(bug.created_at), {
                          addSuffix: true
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
