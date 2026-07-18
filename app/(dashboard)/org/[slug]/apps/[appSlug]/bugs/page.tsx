'use client';

import { useParams } from 'next/navigation';
import { Bug } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { useBugReports } from '@/hooks/bug-reports/use-bug-reports';
import { useApplications } from '@/hooks/applications/use-applications';
import { BugReportsDataTable } from '../../../bugs/_components/bug-reports-data-table';

/**
 * Bugs tab of the per-app control surface — the full bug table, hard-scoped to
 * this one app. Data is pre-filtered by the app's slug (so the app dropdown can
 * never switch away from it) and only this app is offered in the picker.
 */
export default function AppBugsPage() {
  const params = useParams();
  const appSlug = params?.appSlug as string;

  const { organization, loading: orgLoading } = useOrganizationContext();
  const { bugs, loading, refetch } = useBugReports(organization?.id || '');
  const { applications, loading: appsLoading } = useApplications(organization?.id || '');

  if (orgLoading || loading || !organization) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const app = applications.find((a) => a.slug === appSlug);
  // Filter on the embedded application join (the same field the table reads), so
  // this list is correct even if application_id isn't selected on the row.
  const appBugs = bugs.filter(
    (b) => (b as { application?: { slug?: string } }).application?.slug === appSlug
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Bug reports</h2>
        <p className="text-muted-foreground text-sm">
          {appBugs.length} report{appBugs.length === 1 ? '' : 's'} for this app.
        </p>
      </div>

      {appBugs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="bg-muted mb-4 rounded-full p-4">
              <Bug className="text-muted-foreground h-8 w-8" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">No bug reports yet</h3>
            <p className="text-muted-foreground max-w-sm text-center text-sm">
              Reports appear here when users submit them through the SDK integrated in this app.
            </p>
          </CardContent>
        </Card>
      ) : (
        <BugReportsDataTable
          data={appBugs}
          organizationSlug={organization.slug}
          applications={app ? [app] : []}
          applicationsLoading={appsLoading}
          onStatusChange={() => refetch()}
          initialAppSlug={appSlug}
        />
      )}
    </div>
  );
}
