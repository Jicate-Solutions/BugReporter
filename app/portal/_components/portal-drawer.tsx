'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

/**
 * The slide-over frame.
 *
 * Closing goes through router.back() rather than to a hard-coded list URL,
 * because the drawer only ever exists as an interception of a navigation that
 * came from somewhere — going back returns to exactly that view, with its search,
 * filters and page intact. Pushing a fresh list URL would throw all of it away.
 *
 * Focus moves into the panel on open and Escape closes it, so the drawer is
 * operable without a mouse. The backdrop is a real button for the same reason:
 * a click target that only responds to a pointer is invisible to anyone using a
 * keyboard.
 */
export function PortalDrawer({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => router.back();

  useEffect(() => {
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        router.back();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // The list behind must not scroll while the drawer is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [router]);

  return (
    <>
      <button
        type="button"
        onClick={close}
        aria-label="Close report"
        tabIndex={-1}
        className="portal-fade-in fixed inset-0 z-40 cursor-default bg-[rgba(20,22,25,0.28)]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Bug report detail"
        tabIndex={-1}
        className="portal-slide-in fixed inset-y-0 right-0 z-50 flex w-[600px] max-w-[94vw] flex-col border-l border-[var(--p-line)] bg-[var(--p-card)] shadow-[-24px_0_60px_rgba(20,22,25,0.10)] outline-none"
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

        <div className="flex-1 overflow-y-auto px-[26px] pb-[26px] pt-[22px]">
          {children}
        </div>
      </div>
    </>
  );
}
