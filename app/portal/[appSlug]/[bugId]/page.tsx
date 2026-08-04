import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  resolvePortalRequest,
  getReporterBug,
} from '@/lib/services/bug-portal/server';
import { bugStatusLabel } from '@boobalan_jkkn/shared';
import { PortalStatusBadge } from '../../_components/portal-status-badge';
import { PortalShell, PortalNotice } from '../../_components/portal-shell';
import { PortalReplyForm } from '../../_components/portal-reply-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string; bugId: string }>;
  searchParams: Promise<{ u?: string; sig?: string }>;
}

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
          body="Open the portal from within the application you reported the bug in."
        />
      </PortalShell>
    );
  }

  const { application, reporterEmail, config } = resolved;
  const result = await getReporterBug(application.id, reporterEmail, bugId);

  // Not found and not-yours are the same response on purpose.
  if (!result) notFound();

  const { bug, events, messages } = result;
  const backHref = `/portal/${application.slug}?u=${encodeURIComponent(
    reporterEmail
  )}${sig ? `&sig=${encodeURIComponent(sig)}` : ''}`;

  return (
    <PortalShell title={bug.title} subtitle={`${bug.display_id} · ${application.name}`}>
      <Link
        href={backHref}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All my bug reports
      </Link>

      <div className="space-y-8">
        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Current status</span>
            <PortalStatusBadge status={bug.status} />
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {bug.description}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Reported {new Date(bug.created_at).toLocaleString()} on {bug.page_url}
          </p>
        </section>

        {events.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium">History</h2>
            <ol className="space-y-3 border-l pl-4">
              {events.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                  <div className="text-sm">
                    {event.from_status ? (
                      <>
                        {bugStatusLabel(event.from_status)}{' '}
                        <span className="text-muted-foreground">&rarr;</span>{' '}
                        <span className="font-medium">
                          {bugStatusLabel(event.to_status)}
                        </span>
                      </>
                    ) : (
                      <span className="font-medium">
                        {bugStatusLabel(event.to_status)}
                      </span>
                    )}
                  </div>
                  {event.note && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.note}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium">Notes</h2>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => {
                const mine = message.author_kind === 'reporter';
                return (
                  <li
                    key={message.id}
                    className={`rounded-lg border p-3 text-sm ${
                      mine ? 'bg-muted/40' : ''
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.message_text}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {mine ? 'You' : 'Support team'} &middot;{' '}
                      {new Date(message.created_at).toLocaleString()}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {config.allowReporterNotes && (
            <PortalReplyForm
              appSlug={application.slug}
              bugId={bug.id}
              reporterEmail={reporterEmail}
              signature={sig}
            />
          )}
        </section>
      </div>
    </PortalShell>
  );
}
