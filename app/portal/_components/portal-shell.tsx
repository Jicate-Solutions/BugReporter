import type { ReactNode } from 'react';
import type { BugReportStatus } from '@boobalan_jkkn/shared';

/** One slice of the status rule. Sized by count, not by percentage. */
export interface RailSegment {
  status: BugReportStatus;
  value: number;
}

/** The rail's hues, declared once in the portal layout beside the chip tints. */
const RAIL: Record<BugReportStatus, string> = {
  new: 'var(--p-rail-new)',
  seen: 'var(--p-rail-seen)',
  in_progress: 'var(--p-rail-prog)',
  ready_for_testing: 'var(--p-rail-test)',
  resolved: 'var(--p-rail-done)',
  closed: 'var(--p-rail-closed)',
  wont_fix: 'var(--p-rail-wont)',
};

/**
 * Chrome for every portal page.
 *
 * The header is sticky and translucent so the application name and the reporter's
 * own address stay visible while they scroll a long list — on a page whose whole
 * job is "these are *your* reports", losing the attribution to a scroll would be
 * the wrong thing to lose.
 *
 * The line under the header is the header's only ornament, so it does work: given
 * `rail`, the divider IS the proportion of the reporter's reports by status,
 * full-bleed and always on screen because the header is pinned. It used to be a
 * separate bar floating in the body, capped at 760px beside a 1240px table and
 * aligned to nothing, with a legend underneath that repeated the counts already
 * written on the interactive status pills. The bar became the rule and the legend
 * went away; the pills are now the only place those numbers are written.
 *
 * Pages with nothing to summarise — a single report, the notices — pass no rail
 * and get a plain hairline, which is why `rail` is optional rather than a second
 * shell component.
 */
export function PortalShell({
  title,
  subtitle,
  action,
  rail,
  railLabel,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Omit for a plain hairline. Empty array is treated the same way. */
  rail?: RailSegment[];
  /** Spoken description of the rail. Required whenever `rail` has segments. */
  railLabel?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const width = wide ? 'max-w-[1240px]' : 'max-w-3xl';
  const hasRail = Boolean(rail && rail.length > 0);

  return (
    <>
      <div className="sticky top-0 z-20 bg-[rgba(251,251,250,0.88)] backdrop-blur-[12px]">
        <div
          className={`mx-auto flex items-center gap-5 px-5 pb-[15px] pt-[18px] sm:px-8 ${width}`}
        >
          <div className="mr-auto flex min-w-0 flex-col gap-[3px]">
            {/*
              700, not 800. This is utility chrome above a dense table, and the
              heavier cut competed with the report titles it sits over.
            */}
            <h1 className="portal-display truncate text-[20px] font-bold tracking-[-0.02em]">
              {title}
            </h1>
            {subtitle && (
              <p className="truncate text-[12.5px] text-[var(--p-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </div>

        {hasRail ? (
          <div
            className="flex h-1 w-full gap-px"
            role="img"
            aria-label={railLabel}
          >
            {rail!.map((s) => (
              <span
                key={s.status}
                // flexGrow, not a width percentage: the segments divide the
                // track between themselves and the hairline gaps come out of
                // the whole rather than out of the last one.
                style={{ flexGrow: s.value, background: RAIL[s.status] }}
              />
            ))}
          </div>
        ) : (
          <div className="h-px w-full bg-[var(--p-line)]" />
        )}
      </div>

      <main className={`mx-auto px-5 pb-20 pt-6 sm:px-8 ${width}`}>
        {children}
      </main>
    </>
  );
}

/**
 * An identifier, in the face the portal reserves for them.
 *
 * Report codes and email addresses are things people copy, quote back and
 * compare character by character, which is the whole reason the layout loads a
 * mono face. The header was setting them in the body face and so was the one
 * place in the portal that broke its own rule.
 */
export function PortalIdent({ children }: { children: ReactNode }) {
  return (
    <span className="portal-mono text-[12px] text-[var(--p-second)]">
      {children}
    </span>
  );
}

export function PortalNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--p-line-ctrl)] bg-[var(--p-card)] p-12 text-center">
      <p className="portal-display text-[15px] font-bold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-[1.6] text-[var(--p-muted)]">
        {body}
      </p>
    </div>
  );
}
