import { notFound } from 'next/navigation';
import {
  resolvePortalRequest,
  listReporterBugs,
  countReporterBugsByStatus,
  isReporterBugSort,
} from '@/lib/services/bug-portal/server';
import { PortalShell, PortalNotice } from '../_components/portal-shell';
import { PortalSearch } from '../_components/portal-search';
import { PortalBugRow } from '../_components/portal-bug-row';
import { PortalPagination } from '../_components/portal-pagination';
import { PortalProgress } from '../_components/portal-progress';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string }>;
  searchParams: Promise<{
    u?: string;
    sig?: string;
    q?: string;
    status?: string;
    reply?: string;
    sort?: string;
    page?: string;
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
  const {
    u,
    sig,
    q = '',
    status = '',
    reply,
    sort: rawSort,
    page,
  } = await searchParams;

  const needsReply = reply === '1';
  // Anything unrecognised falls back to the default rather than 400ing — a
  // hand-edited URL should degrade, not break a page reporters rely on.
  const sort = isReporterBugSort(rawSort) ? rawSort : 'newest';

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

  const [result, counts] = await Promise.all([
    listReporterBugs(application.id, reporterEmail, {
      q,
      status,
      needsReply,
      sort,
      page: Number(page) || 1,
    }),
    countReporterBugsByStatus(application.id, reporterEmail),
  ]);

  const isFiltering = Boolean(q || status || needsReply);
  const identityQuery = `u=${encodeURIComponent(reporterEmail)}${
    sig ? `&sig=${encodeURIComponent(sig)}` : ''
  }`;

  return (
    <PortalShell
      title="Your bug reports"
      subtitle={`${application.name} · ${reporterEmail}`}
    >
      <PortalProgress total={counts.total} byStatus={counts.byStatus} />

      {counts.total > 0 && (
        <PortalSearch
          identity={{ u: reporterEmail, sig }}
          appSlug={application.slug}
          q={q}
          status={status}
          needsReply={needsReply}
          sort={sort}
          needsReplyTotal={result.needsReplyTotal}
          counts={counts}
        />
      )}

      {result.bugs.length === 0 ? (
        // Two different situations, two different messages. Telling someone who
        // just searched that they have never reported a bug would be wrong.
        isFiltering ? (
          <PortalNotice
            title="No reports match"
            body={
              q
                ? `Nothing matches "${q}". Try a different word, or part of a report ID like BUG-123.`
                : needsReply
                  ? 'Nothing is waiting on you — the team has your last word on every report here.'
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
        <>
          <ul className="space-y-2">
            {result.bugs.map((bug) => (
              <li key={bug.id}>
                <PortalBugRow
                  bug={bug}
                  href={`/portal/${application.slug}/${bug.id}?${identityQuery}`}
                />
              </li>
            ))}
          </ul>

          <PortalPagination
            appSlug={application.slug}
            carry={{
              u: reporterEmail,
              sig,
              q,
              status,
              reply: needsReply ? '1' : undefined,
              sort: sort !== 'newest' ? sort : undefined,
            }}
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
          />
        </>
      )}

    </PortalShell>
  );
}
