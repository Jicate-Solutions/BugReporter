import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import {
  resolvePortalRequest,
  listReporterBugs,
  countReporterBugsByStatus,
  isReporterBugSort,
} from '@/lib/services/bug-portal/server';
import { PortalShell, PortalNotice } from '../_components/portal-shell';
import { PortalStats } from '../_components/portal-stats';
import { PortalFilters } from '../_components/portal-filters';
import { PortalTabs } from '../_components/portal-tabs';
import { PortalTable } from '../_components/portal-table';
import { PortalPagination } from '../_components/portal-pagination';
import { identityQuery, type PortalView } from '../_components/portal-url';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ appSlug: string }>;
  searchParams: Promise<{
    u?: string;
    sig?: string;
    q?: string;
    status?: string;
    area?: string;
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
  const sp = await searchParams;

  const resolved = await resolvePortalRequest(appSlug, sp.u, sp.sig);

  if (!resolved.ok) {
    if (resolved.reason === 'not_found') notFound();

    return (
      <PortalShell title="Bug reports">
        <PortalNotice
          title={
            resolved.reason === 'missing_reporter'
              ? 'This page needs to know who you are'
              : 'This link is not valid'
          }
          body={
            resolved.reason === 'missing_reporter'
              ? 'Open it from inside the application you reported the bug in, so it can identify you.'
              : 'This application requires signed portal links, and this one has no valid signature. Open the portal from inside the application rather than pasting the address directly.'
          }
        />
      </PortalShell>
    );
  }

  const { application, reporterEmail, config } = resolved;

  // Anything unrecognised falls back to the default rather than 400ing — a
  // hand-edited URL should degrade, not break a page reporters rely on.
  const view: PortalView = {
    u: reporterEmail,
    sig: sp.sig,
    q: sp.q ?? '',
    status: sp.status ?? '',
    area: sp.area ?? '',
    reply: sp.reply === '1',
    sort: isReporterBugSort(sp.sort) ? sp.sort : 'newest',
    page: Number(sp.page) || 1,
  };

  const [result, stats] = await Promise.all([
    listReporterBugs(application.id, reporterEmail, {
      q: view.q,
      status: view.status,
      area: view.area,
      needsReply: view.reply,
      sort: view.sort,
      page: view.page,
    }),
    countReporterBugsByStatus(application.id, reporterEmail),
  ]);

  const identity = identityQuery(view);
  const isFiltering = Boolean(view.q || view.status || view.area || view.reply);

  // The address alone was all this header ever said about who is reading it.
  // When the reports carry a name, lead with it and keep the address in
  // brackets — the address is still what the page is scoped by, so dropping it
  // would take away the one thing that explains why these reports and no others.
  const who = stats.reporterName
    ? `${stats.reporterName} (${reporterEmail})`
    : reporterEmail;

  if (stats.total === 0) {
    return (
      <PortalShell
        title={application.name}
        subtitle={`Bug reports · ${who}`}
        wide
      >
        <PortalNotice
          title="Nothing here yet"
          body={`You haven't reported any bugs in ${application.name}. When you do, they'll appear here with whatever the team has done about them.`}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title={application.name}
      subtitle={`Bug reports · ${who}`}
      wide
      action={
        <a
          href={`/api/portal/${application.slug}/export?${identity}`}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-3.5 text-[13.5px] font-medium text-[var(--p-body)] transition-colors hover:border-[#c9c9c5] hover:bg-[#f7f7f5]"
        >
          <Download className="h-[15px] w-[15px]" />
          Export
        </a>
      }
    >
      <PortalStats stats={stats} />

      <PortalFilters appSlug={application.slug} view={view} areas={stats.areas} />

      <PortalTabs
        appSlug={application.slug}
        view={view}
        total={stats.total}
        byStatus={stats.byStatus}
        needsReplyTotal={result.needsReplyTotal}
      />

      {result.bugs.length === 0 ? (
        // Telling someone who just searched that they have never reported a bug
        // would be wrong, so the two situations get two different messages.
        <PortalNotice
          title="No reports match"
          body={
            view.q
              ? `Nothing matches "${view.q}". Try a different word, or part of a report ID like BUG-601.`
              : view.reply
                ? 'Nothing is waiting on you — the team has your last word on every report here.'
                : 'Nothing matches these filters. Clear them to see everything again.'
          }
        />
      ) : (
        <PortalTable
          bugs={result.bugs}
          hrefFor={(bug) =>
            `/portal/${application.slug}/${bug.id}?${identity}`
          }
          // Absent unless the application opted in, which is what makes the
          // rows fall back to plain badges rather than to a control that
          // renders and then fails at the API.
          editStatus={
            config.allowReporterStatus
              ? {
                  appSlug: application.slug,
                  reporterEmail,
                  signature: sp.sig,
                  canReopen: config.allowReporterReopen,
                }
              : undefined
          }
        >
          <PortalPagination
            appSlug={application.slug}
            view={view}
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
          />
        </PortalTable>
      )}

      <p className="mt-[22px] text-[12.5px] text-[var(--p-faint)]">
        Reported from {application.name}
        {isFiltering && (
          <>
            {' · '}
            <Link
              href={`/portal/${application.slug}?${identity}`}
              className="underline underline-offset-2 hover:text-[var(--p-body)]"
            >
              show everything
            </Link>
          </>
        )}
      </p>
    </PortalShell>
  );
}
