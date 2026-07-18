'use client';

import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles } from 'lucide-react';
import { RoutinesManager } from './_components/routines-manager';

export default function RoutinesPage() {
  const { organization, loading } = useOrganizationContext();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!organization) {
    return <div className="text-muted-foreground">Organization not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-blue-600" />
          Routines
        </h1>
        <p className="text-muted-foreground">
          Scheduled AI routines for {organization.name}&apos;s apps — they run on their own, on the ₹0 Max
          lane, and drop their results here. New routines start paused; only admins can enable them.
        </p>
      </div>

      <RoutinesManager organizationId={organization.id} />
    </div>
  );
}
