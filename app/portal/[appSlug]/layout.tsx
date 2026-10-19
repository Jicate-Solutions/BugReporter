import type { ReactNode } from 'react';

/**
 * Declares the drawer slot alongside the page.
 *
 * `drawer` is a parallel route filled by the interceptor at
 * @drawer/(.)[bugId]. Clicking a row from the list soft-navigates: the list
 * stays mounted underneath and the report opens over it. Arriving at the same
 * URL cold — a pasted link, a refresh, a crawler — renders the standalone page
 * through `children` instead, with the slot falling back to @drawer/default.
 *
 * The point of doing it this way rather than with client state is that the URL
 * stays real either way. A reporter can send "here's the one I mean" to their
 * team and it opens.
 *
 * The two slots are laid out as flex columns rather than stacked, because on a
 * wide screen the open report is docked beside the list instead of over it. That
 * makes the list narrow itself to fit, with no measuring and nothing shared
 * between the two routes: the panel is simply an in-flow sibling that takes up
 * width. When the slot is empty — every hard navigation — `drawer` is null,
 * there is one child, and the list is full width without a special case. Below
 * 1280px the panel goes back to `position: fixed`, which takes it out of flow,
 * so the list stops making room for it. See `.portal-dock` in the portal layout.
 */
export default function PortalAppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
  return (
    <div className="portal-dock">
      <div className="portal-dock-main">{children}</div>
      {drawer}
    </div>
  );
}
