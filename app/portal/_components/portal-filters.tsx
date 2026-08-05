'use client';

import { useRef } from 'react';
import { Search } from 'lucide-react';
import type { ReporterBugSort } from '@/lib/services/bug-portal/server';
import type { PortalView } from './portal-url';

interface PortalFiltersProps {
  appSlug: string;
  view: PortalView;
  areas: string[];
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
 * Search, area and sort.
 *
 * A real GET form, not client state. Selects submit on change when JavaScript is
 * running, and the Search button submits everything when it is not — so the page
 * degrades to something fully usable rather than to a dead dropdown.
 *
 * There is no severity control, though the design this follows had one. Nothing
 * in the schema records severity: the SDK never collected it, and the one place
 * that tried to read a `priority` column threw every time it ran. A dropdown
 * offering Blocker / Major / Minor would filter nothing and quietly imply the
 * team is triaging on a field that does not exist.
 */
export function PortalFilters({ appSlug, view, areas }: PortalFiltersProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      method="get"
      action={`/portal/${appSlug}`}
      className="mb-3.5 flex flex-wrap items-center gap-2.5"
    >
      {/* Identity must ride along on every submit, or the page loses the
          reporter and renders empty. */}
      <input type="hidden" name="u" value={view.u} />
      {view.sig && <input type="hidden" name="sig" value={view.sig} />}
      {view.status && (
        <input type="hidden" name="status" value={view.status} />
      )}
      {view.reply && <input type="hidden" name="reply" value="1" />}

      <div className="relative min-w-[260px] flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[var(--p-faint)]" />
        <input
          type="search"
          name="q"
          defaultValue={view.q ?? ''}
          placeholder="Search by title, ID, or area…"
          aria-label="Search your reports"
          className={`${control} w-full pl-[34px] font-normal text-[14px] text-[var(--p-ink)]`}
        />
      </div>

      {/* Rendered only when the data supports more than one answer. */}
      {areas.length > 1 && (
        <select
          name="area"
          defaultValue={view.area ?? ''}
          onChange={submit}
          aria-label="Filter by area of the app"
          className={`${control} cursor-pointer`}
        >
          <option value="">All areas</option>
          {areas.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      )}

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
    </form>
  );
}
