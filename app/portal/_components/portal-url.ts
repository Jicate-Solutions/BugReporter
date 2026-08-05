import type { ReporterBugSort } from '@/lib/services/bug-portal/server';

/** Everything that describes the current view of the list. */
export interface PortalView {
  u: string;
  sig?: string;
  q?: string;
  status?: string;
  area?: string;
  reply?: boolean;
  sort?: ReporterBugSort;
  page?: number;
}

/**
 * Build a list URL from the current view with some parts overridden.
 *
 * Every control on this page is a link or a GET form, so the URL *is* the state.
 * That makes one bug easy to write repeatedly and hard to notice: a control that
 * forgets to carry a parameter silently resets it. Dropping `u` is the worst
 * case — it strips the reporter's identity and empties the page — so every
 * caller goes through here rather than assembling query strings by hand.
 *
 * Defaults are omitted from the output so the common URL stays short enough to
 * paste into a message.
 */
export function portalHref(
  appSlug: string,
  view: PortalView,
  overrides: Partial<PortalView> = {}
): string {
  const next = { ...view, ...overrides };
  const params = new URLSearchParams();

  params.set('u', next.u);
  if (next.sig) params.set('sig', next.sig);
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.area) params.set('area', next.area);
  if (next.reply) params.set('reply', '1');
  if (next.sort && next.sort !== 'newest') params.set('sort', next.sort);
  if (next.page && next.page > 1) params.set('page', String(next.page));

  return `/portal/${appSlug}?${params.toString()}`;
}

/** The identity-only query string, for links out of the list. */
export function identityQuery(view: PortalView): string {
  const params = new URLSearchParams();
  params.set('u', view.u);
  if (view.sig) params.set('sig', view.sig);
  return params.toString();
}
