import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { PortalShell, PortalNotice } from '../../_components/portal-shell';
import {
  PortalDetailHeader,
  PortalDetailBody,
} from '../../_components/portal-detail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string; bugId: string }>;
  searchParams: Promise<{ u?: string; sig?: string }>;
}

/**
 * One report, as a full page.
 *
 * Navigating from the list intercepts this into a drawer, but this route stays
 * the real destination: a link pasted into a message, a refresh, or a visit with
 * JavaScript disabled all land here and get the same content in a plain frame.
 */
export default async function PortalBugPage({ params, searchParams }: PageProps) {
  const { appSlug, bugId } = await params;
  const { u, sig } = await searchParams;

  const resolved = await resolvePortalRequest(appSlug, u, sig);
  if (!resolved.ok) {
    if (resolved.reason === 'not_found') notFound();
    return (
      <PortalShell title="Bug report">
        <PortalNotice
          title="This link is not valid"
          body="Open the portal from inside the application you reported the bug in."
        />
      </PortalShell>
    );
  }

  const { application, reporterEmail, config } = resolved;
  const result = await getReporterBug(application.id, reporterEmail, bugId);

  // Not found and not-yours are the same response on purpose.
  if (!result) notFound();

  const { bug, events, messages } = result;
  const identity = `u=${encodeURIComponent(reporterEmail)}${
    sig ? `&sig=${encodeURIComponent(sig)}` : ''
  }`;

  return (
    <PortalShell
      title={application.name}
      subtitle={`${bug.display_id} · ${reporterEmail}`}
    >
      <Link
        href={`/portal/${application.slug}?${identity}`}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-[var(--p-muted)] transition-colors hover:text-[var(--p-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        All my reports
      </Link>

      <div className="rounded-[14px] border border-[var(--p-line)] bg-[var(--p-card)] p-6">
        <div className="mb-5 border-b border-[var(--p-line-soft)] pb-5">
          <PortalDetailHeader
            appSlug={application.slug}
            bug={bug}
            reporterEmail={reporterEmail}
            signature={sig}
            canSetStatus={config.allowReporterStatus}
            canReopen={config.allowReporterReopen}
          />
        </div>

        <PortalDetailBody
          appSlug={application.slug}
          bug={bug}
          events={events}
          messages={messages}
          reporterEmail={reporterEmail}
          signature={sig}
          allowNotes={config.allowReporterNotes}
          allowReopen={config.allowReporterReopen}
        />
      </div>
    </PortalShell>
  );
}
