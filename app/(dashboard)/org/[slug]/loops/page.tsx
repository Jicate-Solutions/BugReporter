'use client';

import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Repeat } from 'lucide-react';
import { LoopsBoard } from './_components/loops-board';

export default function LoopsPage() {
  const { organization, loading } = useOrganizationContext();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
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
          <Repeat className="h-6 w-6 text-blue-600" />
          Loops
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          The loops behind this platform, and how far each one has earned its keep. A loop only counts
          as &quot;self-improving&quot; once a human&apos;s measured verdict changes what it does next —
          so each one climbs four gates, in order, and nothing is marked done until it truly is.
        </p>
      </div>

      <LoopsBoard organizationSlug={organization.slug} />
    </div>
  );
}
