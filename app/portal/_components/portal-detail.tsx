import { formatDistanceToNow } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import {
  isBugStatus,
  isTerminalBugStatus,
  type AnnotationTool,
} from '@boobalan_jkkn/shared';
import { PortalStatusBadge } from './portal-status-badge';
import { PortalStatusControl } from './portal-status-control';
import { PortalEvidence } from './portal-evidence';
import { PortalTimeline, SectionLabel } from './portal-timeline';
import { PortalComposer } from './portal-composer';
import type {
  PortalBugSummary,
  PortalMessage,
  PortalStatusEvent,
} from '@/lib/services/bug-portal/server';

interface PortalDetailProps {
  appSlug: string;
  bug: PortalBugSummary;
  events: PortalStatusEvent[];
  messages: PortalMessage[];
  reporterEmail: string;
  signature?: string;
  allowNotes: boolean;
  allowReopen: boolean;
  /** Whether this application lets reporters mark up their own screenshot. */
  canAnnotate: boolean;
  annotationTools: AnnotationTool[];
}

/**
 * Everything about one report.
 *
 * Shared verbatim between the slide-over drawer and the standalone page, so the
 * two can never drift into showing different things about the same bug — the
 * drawer is the same content in a different frame, not a summary of it.
 */
export function PortalDetailHeader({
  appSlug,
  bug,
  reporterEmail,
  signature,
  canSetStatus,
  canReopen,
}: {
  appSlug: string;
  bug: PortalBugSummary;
  reporterEmail: string;
  signature?: string;
  /** Whether this application lets reporters set the status themselves. */
  canSetStatus: boolean;
  canReopen: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="portal-mono text-[12px] text-[var(--p-muted)]">
          {bug.display_id}
        </span>
        {/* The control takes the badge's exact slot, so the header reads the
            same whether or not this application has opted in. */}
        {canSetStatus ? (
          <PortalStatusControl
            appSlug={appSlug}
            bugId={bug.id}
            status={bug.status}
            reporterEmail={reporterEmail}
            signature={signature}
            canReopen={canReopen}
          />
        ) : (
          <PortalStatusBadge status={bug.status} />
        )}
        {bug.reopenCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#fff4e5] px-[9px] py-[3px] text-[12px] font-semibold text-[#8a5a12]">
            <RotateCcw className="h-3 w-3" />
            Reopened{bug.reopenCount > 1 ? ` ${bug.reopenCount}×` : ''}
          </span>
        )}
      </div>
      <h2 className="portal-display m-0 text-[21px] font-bold leading-[1.25] tracking-[-0.025em] text-pretty">
        {bug.title}
      </h2>
    </div>
  );
}

export function PortalDetailBody({
  appSlug,
  bug,
  events,
  messages,
  reporterEmail,
  signature,
  allowNotes,
  allowReopen,
  canAnnotate,
  annotationTools,
}: PortalDetailProps) {
  const isClosed = isBugStatus(bug.status) && isTerminalBugStatus(bug.status);

  return (
    <>
      {/*
        The design this follows had a Module / Version / Environment / Reported
        grid. Version is not recorded anywhere, so its cell would have been an
        invented number. Viewport takes the slot instead — it is captured on
        every report, and "the layout breaks at this width" is a real thing a
        reporter is trying to tell you.
      */}
      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--p-line-soft)] bg-[var(--p-line-soft)]">
        {/*
          Who filed it gets the full width of the first row rather than half of
          one. Partly because a name and an address together outrun a half-width
          cell, and partly because the gaps in this grid are the borders — an odd
          fifth cell would leave a hole in the lattice instead of a hairline.
        */}
        <Fact
          label="Reported by"
          value={
            bug.reporterName
              ? `${bug.reporterName} · ${reporterEmail}`
              : reporterEmail
          }
          className="col-span-2"
        />
        <Fact label="Where" value={bug.area} />
        <Fact
          label="Reported"
          value={formatDistanceToNow(new Date(bug.created_at), {
            addSuffix: true,
          })}
        />
        <Fact label="Browser" value={bug.environment} />
        <Fact label="Screen" value={bug.viewport} mono />
      </dl>

      <SectionLabel>What you reported</SectionLabel>
      <p className="mb-6 mt-[9px] text-[14.5px] leading-[1.6] text-pretty text-[var(--p-body)]">
        {bug.description}
      </p>

      <PortalEvidence
        screenshotUrl={bug.screenshot_url}
        attachments={bug.attachments}
        annotate={
          canAnnotate
            ? {
                appSlug,
                bugId: bug.id,
                reporterEmail,
                signature,
                tools: annotationTools,
              }
            : undefined
        }
      />

      <div className="mt-6">
        <PortalTimeline
          events={events}
          messages={messages}
          reporterEmail={reporterEmail}
          reporterName={bug.reporterName}
          createdAt={bug.created_at}
        />
      </div>

      {(allowNotes || (isClosed && allowReopen)) && (
        <PortalComposer
          appSlug={appSlug}
          bugId={bug.id}
          reporterEmail={reporterEmail}
          signature={signature}
          allowNotes={allowNotes}
          canReopen={isClosed && allowReopen}
        />
      )}
    </>
  );
}

function Fact({
  label,
  value,
  mono = false,
  className = '',
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 bg-[var(--p-card)] px-3.5 py-3 ${className}`}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-faint)]">
        {label}
      </dt>
      <dd
        className={`m-0 text-[13.5px] ${mono ? 'portal-mono' : ''} ${
          value ? '' : 'text-[var(--p-faint)]'
        }`}
      >
        {/* An em dash is the honest answer when the SDK did not send this.
            Guessing would be worse than admitting the gap. */}
        {value ?? '—'}
      </dd>
    </div>
  );
}
