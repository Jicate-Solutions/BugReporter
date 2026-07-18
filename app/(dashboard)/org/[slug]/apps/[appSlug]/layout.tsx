import { OrganizationServerService } from '@/lib/services/organizations/server';
import { ApplicationServerService } from '@/lib/services/applications/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bug, ExternalLink, Settings } from 'lucide-react';
import { AppTabNav } from './_components/app-tab-nav';

/**
 * Shell for the per-app control surface: a persistent header + the tab bar, with
 * the active tab rendered as {children}. Every tab (Overview / Bugs / AI /
 * Routines / Uptime) and the Settings sub-page share this frame, so the app
 * context never disappears as you move between lenses.
 */
export default async function ApplicationLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; appSlug: string }>;
}) {
  const { slug, appSlug } = await params;

  const organization = await OrganizationServerService.getOrganizationBySlug(slug);
  if (!organization) notFound();

  const application = await ApplicationServerService.getApplicationBySlug(organization.id, appSlug);
  if (!application) notFound();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2">
          <Link href={`/org/${slug}/apps`}>
            <ArrowLeft className="h-4 w-4" />
            Back to Applications
          </Link>
        </Button>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-3">
              <Bug className="text-primary h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{application.name}</h1>
              <p className="text-muted-foreground">
                Application in <span className="text-foreground font-medium">{organization.name}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={application.app_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Visit
              </a>
            </Button>
            <Button asChild className="bg-linear-to-r from-blue-600 to-blue-700 text-white">
              <Link href={`/org/${slug}/apps/${appSlug}/edit`}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <AppTabNav slug={slug} appSlug={appSlug} />

      {/* Active tab */}
      <div>{children}</div>
    </div>
  );
}
