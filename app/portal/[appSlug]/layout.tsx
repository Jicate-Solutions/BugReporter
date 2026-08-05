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
 */
export default function PortalAppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
