'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

/** Matches the `.portal-panel` media query in the portal layout. */
const DOCKED_QUERY = '(min-width: 1280px)';

/**
 * The report panel.
 *
 * Docked beside the list on a wide screen, floating over it on a narrow one —
 * the geometry of both lives in `.portal-panel`, so what is left here is the
 * behaviour that has to differ between them. Docked, the list is meant to be
 * read and clicked while a report is open, which rules out the two things that
 * made this a modal: locking the body scroll and claiming `aria-modal`. Neither
 * is merely cosmetic. A stuck scroll lock freezes a page that looks interactive,
 * and `aria-modal` on a panel that is not modal sends a screen reader looking
 * for a boundary that is not there.
 *
 * Closing goes through router.back() rather than to a hard-coded list URL,
 * because the panel only ever exists as an interception of a navigation that
 * came from somewhere — going back returns to exactly that view, with its search,
 * filters and page intact. Pushing a fresh list URL would throw all of it away.
 * That holds no matter how many reports were opened in a row, because the rows
 * replace rather than push once the panel is up (see portal-row-link.tsx).
 *
 * Focus moves into the panel on open and Escape closes it, so the panel is
 * operable without a mouse. The scrim is a real button for the same reason: a
 * click target that only responds to a pointer is invisible to anyone using a
 * keyboard.
 */
export function PortalDrawer({
  bugId,
  header,
  children,
}: {
  /** Which report is showing. Only used to reset the scroll between reports. */
  bugId: string;
  header: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  // Starts false so the server render and the first client render agree; the
  // effect corrects it before paint matters. Guessing `true` here would flash a
  // missing scrim on a phone.
  const [docked, setDocked] = useState(false);

  const close = () => router.back();

  useEffect(() => {
    const media = window.matchMedia(DOCKED_QUERY);
    const sync = () => setDocked(media.matches);

    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        router.back();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router]);

  useEffect(() => {
    // Only while the panel covers the list. Docked it sits beside it, and a
    // list you can see but cannot scroll is worse than no dock at all.
    if (docked) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [docked]);

  return (
    <>
      <button
        type="button"
        onClick={close}
        aria-label="Close report"
        tabIndex={-1}
        className="portal-panel-scrim portal-fade-in cursor-default"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={!docked}
        aria-label="Bug report detail"
        tabIndex={-1}
        className="portal-panel portal-slide-in"
      >
        <div className="flex items-start gap-3.5 border-b border-[var(--p-line-soft)] px-[26px] pb-[18px] pt-[22px]">
          {header}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] text-[var(--p-second)] transition-colors hover:bg-[#f4f4f2]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/*
          Keyed by report so switching rows remounts the scroll container. The
          panel itself is reused across that swap — that is what makes hopping
          between rows feel instant — but a reused element keeps its scroll
          offset, so the next report would open halfway down for no reason the
          reader can see.
        */}
        <div
          key={bugId}
          className="flex-1 overflow-y-auto px-[26px] pb-[26px] pt-[22px]"
        >
          {children}
        </div>
      </div>
    </>
  );
}
