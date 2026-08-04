import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Bug, ExternalLink } from 'lucide-react';
import {
  resolvePortalRequest,
  listReporterBugs,
  countReporterBugsByStatus,
} from '@/lib/services/bug-portal/server';
import { PortalStatusBadge } from '../_components/portal-status-badge';
import { PortalShell, PortalNotice } from '../_components/portal-shell';
import { PortalSearch } from '../_components/portal-search';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string }>;
  searchParams: Promise<{
    u?: string;
    sig?: string;
    q?: string;
    status?: string;
  }>;
}

/**
 * The reporter-facing bug list.
 *
 * Rendered on the server with the service-role client and scoped to
 * application + reporter, so the page never receives an API key and a reporter
 * can only ever be served their own bugs.
 */
export default async function PortalPage({ params, searchParams }: PageProps) {
  const { appSlug } = await params;
  const { u, sig, q = '', status = '' } = await searchParams;

  const resolved = await resolvePortalRequest(appSlug, u, sig);

  if (!resolved.ok) {
    if (resolved.reason === 'not_found') notFound();

    return (
      <PortalShell title="Bug reports">
        <PortalNotice
          title={
            resolved.reason === 'missing_reporter'
              ? 'Who are you?'
              : 'This link is not valid'
          }
          body={
            resolved.reason === 'missing_reporter'
              ? 'This page needs to know which reporter you are. Open it from within the application you reported the bug in, so it can identify you.'
              : 'This application requires signed portal links, and this link is missing a valid signature. Open the portal from within the application rather than pasting the address directly.'
          }
        />
      </PortalShell>
    );
  }

  const { application, reporterEmail } = resolved;

  const [bugs, counts] = await Promise.all([
    listReporterBugs(application.id, reporterEmail, { q, status }),
    countReporterBugsByStatus(application.id, reporterEmail),
  ]);

  const isFiltering = Boolean(q || status);

  return (
    <PortalShell
      title={`${application.name} — your bug reports`}
      subtitle={reporterEmail}
    >
      {counts.total > 0 && (
        <PortalSearch
          identity={{ u: reporterEmail, sig }}
          appSlug={application.slug}
          q={q}
          status={status}
          counts={counts}
        />
      )}

      {bugs.length === 0 ? (
        // Two different situations, two different messages. Telling someone who
        // just searched that they have never reported a bug would be wrong.
        isFiltering ? (
          <PortalNotice
            title="No reports match"
            body={
              q
                ? `Nothing matches "${q}". Try a different word, or part of a report ID like BUG-123.`
                : 'No reports have that status yet.'
            }
          />
        ) : (
          <PortalNotice
            title="Nothing here yet"
            body={`You haven't reported any bugs in ${application.name}. When you do, they'll appear here with their current status.`}
          />
        )
      ) : (
        <ul className="space-y-3">
          {bugs.map((bug) => (
            <li key={bug.id}>
              <Link
                prefetch={false}
                href={`/portal/${application.slug}/${bug.id}?u=${encodeURIComponent(
                  reporterEmail
                )}${sig ? `&sig=${encodeURIComponent(sig)}` : ''}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Bug className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{bug.title}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {bug.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {bug.display_id} &middot;{' '}
                      {new Date(bug.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <PortalStatusBadge status={bug.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 flex items-center gap-1 text-xs text-muted-foreground">
        <ExternalLink className="h-3 w-3" />
        Reported from {application.name}
      </p>
    </PortalShell>
  );
}
