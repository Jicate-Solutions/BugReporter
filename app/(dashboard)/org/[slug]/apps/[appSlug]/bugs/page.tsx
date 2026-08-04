'use client';

import { useParams } from 'next/navigation';
import { Bug, AlertCircle } from 'lucide-react';
import type { Application } from '@boobalan_jkkn/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { useBugReports } from '@/hooks/bug-reports/use-bug-reports';
import { useBugFilters } from '@/hooks/bug-reports/use-bug-filters';
import { useApplications } from '@/hooks/applications/use-applications';
import { BugReportsDataTable } from '../../../bugs/_components/bug-reports-data-table';

function TableSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

/** Explicit failure state — never let a failed fetch masquerade as "empty". */
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <AlertCircle className="text-destructive h-8 w-8" />
        <p className="max-w-sm text-sm font-medium">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Bugs tab of the per-app control surface — the full bug table, scoped to this
 * one app. The child mounts only once the app id is resolved, so the fetch runs
 * app-scoped server-side (useBugReports adds organization_id; we add
 * application_id) — a large org never ships every bug just to show one app's.
 */
export default function AppBugsPage() {
  const params = useParams();
  const appSlug = params?.appSlug as string;

  const { organization, loading: orgLoading } = useOrganizationContext();
  const {
    applications,
    loading: appsLoading,
    error: appsError,
    refetch: refetchApps
  } = useApplications(organization?.id || '');

  if (orgLoading || appsLoading || !organization) {
    return <TableSkeleton />;
  }

  // Distinguish a failed apps fetch from a genuinely-missing app — otherwise a
  // network hiccup reads as "this application could not be found".
  if (appsError) {
    return (
      <ErrorState
        message="Couldn't load this organization's applications. Check your connection and try again."
        onRetry={() => refetchApps()}
      />
    );
  }

  const app = applications.find((a) => a.slug === appSlug);
  if (!app) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          This application could not be found.
        </CardContent>
      </Card>
    );
  }

  return (
    <AppBugsTable
      organizationId={organization.id}
      organizationSlug={organization.slug}
      app={app}
    />
  );
}

function AppBugsTable({
  organizationId,
  organizationSlug,
  app
}: {
  organizationId: string;
  organizationSlug: string;
  app: Application;
}) {
  // Server-side scoped: only this app's bugs are fetched (the hook injects
  // organization_id; the application_id filter narrows to this app).
  const { bugs, loading, error, refetch } = useBugReports(organizationId, { application_id: app.id });

  // Filters are owned here rather than inside the table — see the org bug list
  // for the full reasoning. The short version: showing the skeleton during a
  // refetch unmounted the table and wiped the user's filters.
  const [filters, setFilters] = useBugFilters();

  if (loading && bugs.length === 0) {
    return <TableSkeleton />;
  }

  // A failed fetch leaves bugs=[]; render the failure explicitly so it never
  // masquerades as "this app has no bugs".
  if (error) {
    return (
      <ErrorState
        message="Couldn't load this app's bug reports. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Bug reports</h2>
        <p className="text-muted-foreground text-sm">
          {bugs.length} report{bugs.length === 1 ? '' : 's'} for this app.
        </p>
      </div>

      {bugs.length === 0 ? (
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
          data={bugs}
          organizationSlug={organizationSlug}
          applications={[app]}
          applicationsLoading={false}
          onStatusChange={() => refetch()}
          filters={filters}
          onFiltersChange={setFilters}
          refreshing={loading}
        />
      )}
    </div>
  );
}
