import { OrganizationServerService } from '@/lib/services/organizations/server';
import { ApplicationServerService } from '@/lib/services/applications/server';
import { notFound } from 'next/navigation';
import { RoutinesManager } from '../../../routines/_components/routines-manager';

export default async function AppRoutinesPage({
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
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Routines</h2>
        <p className="text-muted-foreground text-sm">
          Scheduled ₹0 AI routines scoped to this app. New routines start paused — set a schedule, then enable.
        </p>
      </div>
      <RoutinesManager organizationId={organization.id} applicationId={application.id} />
    </div>
  );
}
