import { OrganizationServerService } from '@/lib/services/organizations/server';
import { ApplicationServerService } from '@/lib/services/applications/server';
import { notFound } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { AiFleetBriefingCard } from '../../../bugs/_components/rollups/ai-fleet-briefing-card';
import { AiTriageHelperCard } from '../../../bugs/_components/rollups/ai-triage-helper-card';
import { AiDuplicateFinderCard } from '../../../bugs/_components/rollups/ai-duplicate-finder-card';

export default async function AppAiPage({
  params
}: {
  params: Promise<{ slug: string; appSlug: string }>;
}) {
  const { slug, appSlug } = await params;

  const organization = await OrganizationServerService.getOrganizationBySlug(slug);
  if (!organization) notFound();

  const application = await ApplicationServerService.getApplicationBySlug(organization.id, appSlug);
  if (!application) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-blue-600" />
          AI — {application.name}
        </h2>
        <p className="text-muted-foreground text-sm">
          AI tools scoped to just this app, on the ₹0 Max lane. Jobs queue behind MyJKKN&apos;s own work; there is no paid fallback.
        </p>
      </div>

      <AiFleetBriefingCard organizationId={organization.id} applicationId={application.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AiTriageHelperCard organizationId={organization.id} applicationId={application.id} />
        <AiDuplicateFinderCard organizationId={organization.id} applicationId={application.id} />
      </div>
    </div>
  );
}
