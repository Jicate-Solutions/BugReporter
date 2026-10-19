'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export interface BugFilters {
  /** Free-text search across title, description and reporter. */
  q: string;
  /** Bug status, or '' for all. */
  status: string;
  /** Bug category, or '' for all. */
  category: string;
  /** Application SLUG (not id) so the URL stays readable and shareable. */
  app: string;
}

const EMPTY: BugFilters = { q: '', status: '', category: '', app: '' };

/**
 * Bug list filters, held above the table and mirrored into the URL.
 *
 * Two problems are solved here at once.
 *
 * The filters used to live inside BugReportsDataTable. Refetching after a status
 * change flipped the page's `loading` flag, which early-returned a skeleton and
 * unmounted the table — destroying all of its state. Holding the filters in a
 * component that never unmounts fixes that.
 *
 * They are also mirrored to the query string so they survive a genuine reload
 * and a filtered view can be shared or bookmarked. The mirror uses
 * `history.replaceState` rather than `router.replace` deliberately: the bug list
 * is a client component, so a router navigation on every keystroke would cost a
 * round-trip and stack up history entries for nothing. Next.js supports reading
 * params written this way, and the value we care about on reload is read from
 * `useSearchParams` on first render anyway.
 */
export function useBugFilters(): [
  BugFilters,
  (patch: Partial<BugFilters>) => void,
  () => void,
] {
  const searchParams = useSearchParams();

  // Read once, on mount. After that the URL is an output, not an input —
  // otherwise every mirror write would feed back in as a change.
  const [filters, setFilters] = useState<BugFilters>(() => ({
    q: searchParams.get('q') ?? '',
    status: searchParams.get('status') ?? '',
    category: searchParams.get('category') ?? '',
    app: searchParams.get('app') ?? '',
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Preserve any unrelated params rather than rewriting the whole string.
    const next = new URLSearchParams(window.location.search);
    (Object.keys(filters) as (keyof BugFilters)[]).forEach((key) => {
      const value = filters[key];
      if (value) next.set(key, value);
      else next.delete(key);
    });

    const qs = next.toString();
    const url = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;

    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', url);
    }
  }, [filters]);

  const update = useCallback((patch: Partial<BugFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setFilters(EMPTY), []);

  return [filters, update, reset];
}

/** True when anything is filtering the list — drives the "Clear" affordance. */
export function hasActiveFilters(filters: BugFilters): boolean {
  return Boolean(filters.q || filters.status || filters.category || filters.app);
}
