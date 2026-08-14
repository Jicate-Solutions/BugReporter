'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { MessageSquare, Search, X } from 'lucide-react';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import type { ReporterBugSort } from '@/lib/services/bug-portal/server';
import { portalHref, type PortalView } from './portal-url';

interface PortalFiltersProps {
  appSlug: string;
  view: PortalView;
  total: number;
  byStatus: Record<string, number>;
  needsReplyTotal: number;
}

const SORT_OPTIONS: { value: ReporterBugSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'activity', label: 'Most recent activity' },
];

const control =
  'h-10 rounded-[10px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-3 ' +
  'text-[13.5px] font-medium text-[var(--p-body)] outline-none transition-colors ' +
  'focus:border-[#b8bcc4] focus:ring-[3px] focus:ring-black/5';

/**
 * Everything that narrows the list, in one panel.
 *
 * Search, status and sort were three separate things in two loose bands: a form
 * row floating on the page background and, under it, a row of status pills that
 * repeated the counts already drawn in the summary bar above them. They are one
 * control surface now — one bordered panel, one row, one mental model.
 *
 * Status is a select rather than pills. Pills showed every count at once and
 * filtered in a single click, which is genuinely better for scanning; the trade
 * is that they cost a whole row and only ever listed statuses this reporter
 * happened to have. The counts survive inside the option labels.
 *
 * A real GET form, not client state. The selects submit on change when
 * JavaScript is running, and the Search button submits everything when it is
 * not — so the page degrades to something fully usable rather than to a dead
 * dropdown.
 *
 * There is no area control. It only ever appeared for reporters whose bugs came
 * from more than one screen, which made it a control some people had and others
 * did not, and the area is still readable in the list's Where column and on the
 * report itself.
 *
 * There is no severity control either, though the design this follows had one.
 * Nothing in the schema records severity: the SDK never collected it, and the one
 * place that tried to read a `priority` column threw every time it ran. A
 * dropdown offering Blocker / Major / Minor would filter nothing and quietly
 * imply the team is triaging on a field that does not exist.
 */
export function PortalFilters({
  appSlug,
  view,
  total,
  byStatus,
  needsReplyTotal,
}: PortalFiltersProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => formRef.current?.requestSubmit();

  // Every status the workflow uses, not only the ones this reporter happens to
  // have today. Listing just the non-empty ones made the menu change shape from
  // one visit to the next and hid the fact that "In Progress" exists at all —
  // which is exactly the question a reporter opens this page to ask. A status
  // with nothing in it still tells them something true, so it keeps its row and
  // shows its zero.
  const statusOptions = BUG_STATUSES.map((s: BugReportStatus) => ({
    status: s,
    count: byStatus[s] ?? 0,
  }));

  const filtering = Boolean(view.q || view.status || view.reply);

  return (
    <form
      ref={formRef}
      method="get"
      action={`/portal/${appSlug}`}
      className="mb-[18px] flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--p-line)] bg-[var(--p-card)] p-3"
    >
      {/* Identity must ride along on every submit, or the page loses the
          reporter and renders empty. */}
      <input type="hidden" name="u" value={view.u} />
      {view.sig && <input type="hidden" name="sig" value={view.sig} />}
      {view.reply && <input type="hidden" name="reply" value="1" />}

      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[var(--p-faint)]" />
        <input
          type="search"
          name="q"
          defaultValue={view.q ?? ''}
          // Says what the search actually does. listReporterBugs matches q
          // against the title, the description and the display id — never the
          // area — so the old "title, ID, or area" promised a match this has
          // never been able to make.
          placeholder="Search by title or report ID…"
          aria-label="Search your reports"
          className={`${control} w-full pl-[34px] font-normal text-[14px] text-[var(--p-ink)]`}
        />
      </div>

      <select
        name="status"
        defaultValue={view.status ?? ''}
        onChange={submit}
        aria-label="Filter by status"
        className={`${control} cursor-pointer`}
      >
        <option value="">All {total}</option>
        {statusOptions.map(({ status, count }) => (
          <option key={status} value={status}>
            {BUG_STATUS_LABELS[status]} {count}
          </option>
        ))}
      </select>

      <select
        name="sort"
        defaultValue={view.sort ?? 'newest'}
        onChange={submit}
        aria-label="Sort reports"
        className={`${control} cursor-pointer`}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="h-10 rounded-[10px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-3.5 text-[13.5px] font-medium text-[var(--p-body)] transition-colors hover:border-[#c9c9c5] hover:bg-[#f7f7f5]"
      >
        Search
      </button>

      {/*
        A link, not a control in this form: it is the one filter that describes
        an obligation rather than a state, and it toggles rather than selects.
        Pushed to the far edge so that distinction survives a row that happens
        to be short.
      */}
      {needsReplyTotal > 0 && (
        <Link
          href={portalHref(appSlug, view, { reply: !view.reply, page: 1 })}
          aria-current={view.reply ? 'true' : undefined}
          className={`ml-auto inline-flex h-10 items-center gap-[7px] rounded-[10px] border px-3.5 text-[13px] font-medium transition-colors ${
            view.reply
              ? 'border-[var(--p-accent)] bg-[var(--p-accent)] text-white'
              : 'border-[#f0d9a8] bg-[#fff9ed] text-[#8a5a12] hover:bg-[#fef3dd]'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Needs your reply
          <span className="text-[12px] tabular-nums opacity-60">
            {needsReplyTotal}
          </span>
        </Link>
      )}

      {filtering && (
        <Link
          href={portalHref(appSlug, { u: view.u, sig: view.sig })}
          className={`inline-flex items-center gap-1 text-[12.5px] text-[var(--p-muted)] transition-colors hover:text-[var(--p-ink)] ${
            needsReplyTotal > 0 ? '' : 'ml-auto'
          }`}
        >
          <X className="h-3 w-3" />
          Clear
        </Link>
      )}
    </form>
  );
}
