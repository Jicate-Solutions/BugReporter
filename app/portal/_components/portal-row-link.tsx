'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A row's link to its report, aware of whether one is already open.
 *
 * The panel docks beside the list rather than covering it, which means a reader
 * can go straight from one report to the next without closing anything. Left
 * alone that quietly breaks the close button: each row would push its own
 * history entry, and `router.back()` — which is how the panel closes, so that
 * the list comes back with its search and filters intact — would walk back
 * through every report visited. Open four, press ✕ four times.
 *
 * So the second and subsequent rows replace instead of push. History stays two
 * deep, `list → report`, and one press of ✕ (or the browser's own Back) always
 * lands on the list no matter how long the reader browsed.
 *
 * "Is one already open" is read off the path rather than passed down: a report
 * URL is /portal/:appSlug/report/:bugId and the list is /portal/:appSlug, so the
 * `report` segment is the whole test. The alternative is threading a flag down
 * from a layout that does not know either.
 *
 * That segment is not decoration. The panel is an intercepting route, and Next
 * rewrites the intercepted path by prefixing the `(.)` marker onto it — with a
 * bare `(.)[bugId]` the rewritten `/(.)<id>` matches `[bugId]` all over again,
 * because a dynamic segment matches the marker too. The rewrite then runs away,
 * the RSC request 500s, and Next falls back to a hard navigation that cannot be
 * intercepted at all. A static segment is what stops the pattern matching its
 * own output.
 */
export function PortalRowLink({
  href,
  className,
  'aria-label': ariaLabel,
}: {
  href: string;
  className?: string;
  'aria-label': string;
}) {
  const pathname = usePathname();
  const panelOpen = pathname.includes('/report/');

  return (
    <Link
      href={href}
      replace={panelOpen}
      prefetch={false}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
