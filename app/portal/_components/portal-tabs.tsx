import Link from 'next/link';
import { MessageSquare, X } from 'lucide-react';
import { BUG_STATUSES, BUG_STATUS_LABELS, type BugReportStatus } from '@boobalan_jkkn/shared';
import { portalHref, type PortalView } from './portal-url';

interface PortalTabsProps {
  appSlug: string;
  view: PortalView;
  total: number;
  byStatus: Record<string, number>;
  needsReplyTotal: number;
}

/**
 * Status as a row of counted pills.
 *
 * Links, not buttons — each one is a real filtered URL a reporter can bookmark
 * or send to the team, and it costs no JavaScript. Statuses with nothing in them
 * are hidden, so every pill on screen leads somewhere and the row stays short
 * enough to read in one pass.
 *
 * "Needs your reply" sits at the end of the same row because it is the same kind
 * of thing — a filter over the same list — but it is the only one that describes
 * an obligation rather than a state, so it is the only one that changes tone
 * when it has a count.
 */
export function PortalTabs({
  appSlug,
  view,
  total,
  byStatus,
  needsReplyTotal,
}: PortalTabsProps) {
  const active = BUG_STATUSES.filter(
    (s: BugReportStatus) => (byStatus[s] ?? 0) > 0
  );

  const filtering = Boolean(view.q || view.status || view.area || view.reply);

  // One status covering everything makes the row a label, not a control.
  if (active.length <= 1 && needsReplyTotal === 0 && !filtering) return null;

  return (
    <div className="mb-[18px] flex flex-wrap items-center gap-[7px]">
      {active.length > 1 && (
        <>
          <Pill
            href={portalHref(appSlug, view, { status: '', page: 1 })}
            active={!view.status}
          >
            All <Count>{total}</Count>
          </Pill>
          {active.map((s: BugReportStatus) => (
            <Pill
              key={s}
              href={portalHref(appSlug, view, { status: s, page: 1 })}
              active={view.status === s}
            >
              {BUG_STATUS_LABELS[s]} <Count>{byStatus[s]}</Count>
            </Pill>
          ))}
        </>
      )}

      {needsReplyTotal > 0 && (
        <Pill
          href={portalHref(appSlug, view, { reply: !view.reply, page: 1 })}
          active={Boolean(view.reply)}
          tone="attention"
        >
          <MessageSquare className="h-3 w-3" />
          Needs your reply <Count>{needsReplyTotal}</Count>
        </Pill>
      )}

      {filtering && (
        <Link
          href={portalHref(appSlug, {
            u: view.u,
            sig: view.sig,
          })}
          className="ml-1 inline-flex items-center gap-1 text-[12.5px] text-[var(--p-muted)] transition-colors hover:text-[var(--p-ink)]"
        >
          <X className="h-3 w-3" />
          Clear
        </Link>
      )}
    </div>
  );
}

function Pill({
  href,
  active,
  tone = 'default',
  children,
}: {
  href: string;
  active: boolean;
  tone?: 'default' | 'attention';
  children: React.ReactNode;
}) {
  const base =
    'inline-flex h-8 items-center gap-[7px] rounded-full border px-[13px] text-[13px] font-medium transition-colors';

  const styles = active
    ? 'border-[var(--p-accent)] bg-[var(--p-accent)] text-white'
    : tone === 'attention'
      ? 'border-[#f0d9a8] bg-[#fff9ed] text-[#8a5a12] hover:bg-[#fef3dd]'
      : 'border-[var(--p-line-ctrl)] bg-[var(--p-card)] text-[var(--p-body)] hover:bg-[#f7f7f5]';

  return (
    <Link href={href} aria-current={active ? 'true' : undefined} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] tabular-nums opacity-60">{children}</span>;
}
