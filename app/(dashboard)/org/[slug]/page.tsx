import { OrganizationServerService } from '@/lib/services/organizations/server';
import { notFound } from 'next/navigation';
import { DashboardContent } from './_components/dashboard-content';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SafetyAlertBanner } from './ai/safety/_components/safety-alert-banner';

interface OrganizationPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function OrganizationPage({ params }: OrganizationPageProps) {
  const { slug } = await params;
  const organization = await OrganizationServerService.getOrganizationBySlug(slug);

  if (!organization) {
    notFound();
  }

  const stats = await OrganizationServerService.getOrganizationStats(organization.id);
  const {
    data: { user }
  } = await (await createClient()).auth.getUser();

  return (
    <div className="space-y-6">
      <SafetyAlertBanner admin={createAdminClient()} userId={user?.id} slug={slug} />
      <DashboardContent organization={organization} initialStats={stats} />
    </div>
  );
}
