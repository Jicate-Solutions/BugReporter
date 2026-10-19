import { notFound } from 'next/navigation';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { PortalDrawer } from '../../../../_components/portal-drawer';
import {
  PortalDetailHeader,
  PortalDetailBody,
} from '../../../../_components/portal-detail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string; bugId: string }>;
  searchParams: Promise<{ u?: string; sig?: string }>;
}

/**
 * A report, opened over the list.
 *
 * Intercepts /portal/:appSlug/:bugId when it is reached by clicking a row. The
 * body is the same component the standalone page renders, so the two cannot show
 * different things about the same report — only a different frame around it.
 *
 * Authorization is re-resolved here rather than inherited from the list. This is
 * its own request to its own route, and a component that trusted the list to
 * have checked would be one refactor away from serving someone else's report.
 */
export default async function PortalBugDrawer({
  params,
  searchParams,
}: PageProps) {
  const { appSlug, bugId } = await params;
  const { u, sig } = await searchParams;

  const resolved = await resolvePortalRequest(appSlug, u, sig);
  if (!resolved.ok) notFound();

  const { application, reporterEmail, config } = resolved;
  const result = await getReporterBug(application.id, reporterEmail, bugId);

  // Not found and not-yours are the same response on purpose.
  if (!result) notFound();

  const { bug, events, messages } = result;

  return (
    <PortalDrawer
      bugId={bug.id}
      header={
        <PortalDetailHeader
          appSlug={application.slug}
          bug={bug}
          reporterEmail={reporterEmail}
          signature={sig}
          canSetStatus={config.allowReporterStatus || config.allowReporterClose}
          canSetAnyStatus={config.allowReporterStatus}
          canClose={config.allowReporterClose}
          canReopen={config.allowReporterReopen}
        />
      }
    >
      <PortalDetailBody
        appSlug={application.slug}
        bug={bug}
        events={events}
        messages={messages}
        reporterEmail={reporterEmail}
        signature={sig}
        allowNotes={config.allowReporterNotes}
        allowReopen={config.allowReporterReopen}
        canAnnotate={resolved.canAnnotate}
        annotationTools={resolved.annotationTools}
      />
    </PortalDrawer>
  );
}
