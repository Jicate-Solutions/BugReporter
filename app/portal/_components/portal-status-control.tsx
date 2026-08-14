'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  BUG_STATUS_LABELS,
  SELECTABLE_BUG_STATUSES,
  bugStatusLabel,
  canActorSetStatus,
  isBugStatus,
  isReopenTransition,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import { portalStatusChip } from './portal-status-badge';

const POPOVER_WIDTH = 268;
/** Distance from the chip. */
const GAP = 6;
/** Closest the popover may come to a viewport edge. */
const MARGIN = 8;

interface PortalStatusControlProps {
  appSlug: string;
  bugId: string;
  status: string;
  reporterEmail: string;
  signature?: string;
  /**
   * Whether this application also lets reporters reopen. Independent of the
   * status permission, so a bug can be editable without every option being
   * reachable — moving a closed report back to an open status is a reopen no
   * matter which control produced it.
   */
  canReopen: boolean;
  /**
   * Whether this application lets reporters set any status at all, as opposed
   * to only accepting a fix. Off for most applications: it is the power to
   * declare your own bug resolved without anyone having looked at it.
   */
  canSetAnyStatus: boolean;
  /**
   * Whether this application lets reporters close a report the team has marked
   * ready for testing. On by default — it is the reporter's half of the
   * verification handoff, and with it off nothing the team fixes ever completes.
   */
  canClose: boolean;
}

/**
 * Where a portalled popover may be parented.
 *
 * Not document.body, which is the reflex. The portal's entire palette and all
 * three of its typefaces are declared on `.portal-root` in the layout, so a
 * popover hung off the body inherits none of them and renders as transparent
 * boxes with a currentColor border in the wrong font — the rows behind show
 * straight through it. `.portal-root` is the nearest ancestor that is both
 * inside that variable scope and outside every overflow-hidden container the
 * table puts in the way.
 *
 * The fallback keeps this honest if the class is ever renamed: a popover with
 * no colours is still better than a crash.
 */
function popoverHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.portal-root') ?? document.body;
}

/**
 * Where the popover sits, in viewport coordinates.
 *
 * Below the chip by preference, flipped above when below would overflow and
 * above has room. Both results are then clamped into the viewport, because a
 * correctly flipped popover that is still half off-screen is no better than an
 * unflipped one — down a list of twenty-eight rows the chip is near an edge as
 * often as not.
 */
function placePopover(
  anchor: DOMRect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number }
): { top: number; left: number } {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - popover.height;
  const fitsBelow = below + popover.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN ? below : above;

  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, MARGIN), Math.max(MARGIN, max));

  return {
    top: clamp(top, viewport.height - popover.height - MARGIN),
    left: clamp(anchor.left, viewport.width - popover.width - MARGIN),
  };
}

/**
 * The status chip, when the reporter is allowed to change it.
 *
 * Picking a status writes it. One click, no confirm step — the chip switches to
 * the new status immediately and reverts only if the server refuses. A status
 * change does email the app owner and fire a webhook, so this is a real trade:
 * the speed of a dropdown against a mis-click that cannot be undone from this
 * side of the portal.
 *
 * The one exception is a reopen, which keeps a second step because the route
 * will not accept one without a written reason — POST .../status answers a
 * note-less reopen with 400 "Tell the team what is still wrong." Applying it on
 * the click would put an error toast where the reporter expected a status.
 *
 * It renders as a chip, not a form control. At rest it is pixel-identical to
 * PortalStatusBadge apart from the chevron, so the list and the detail header do
 * not look like two different applications.
 *
 * And the popover is portalled out rather than positioned against the chip. In
 * the detail header it could have been absolute; in a table row it cannot,
 * because the list clips its own rounded corners with overflow-hidden and would
 * take the bottom off any menu opened near the end of the page. Escaping the
 * clip means giving up on offset parents, so the position gets measured instead
 * — and measuring is also what makes flipping above possible.
 */
export function PortalStatusControl({
  appSlug,
  bugId,
  status,
  reporterEmail,
  signature,
  canReopen,
  canSetAnyStatus,
  canClose,
}: PortalStatusControlProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Every row of the list renders one of these, so the note field cannot carry
  // a hard-coded id without repeating it down the page and pointing every label
  // at the first one.
  const noteId = useId();

  const [optimistic, setOptimistic] = useState(status);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<BugReportStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The server is the authority. Without this, a change that failed and was
  // retried can leave the chip showing a status the server never accepted.
  useEffect(() => {
    setOptimistic(status);
  }, [status]);

  const close = () => {
    setOpen(false);
    setPending(null);
    setNote('');
    setPos(null);
  };

  // Measure on open, and again whenever the popover changes size — the confirm
  // step is taller than the option list, which can turn a menu that fitted
  // below into one that does not.
  useEffect(() => {
    if (!open) return;

    const measure = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      setPos(
        placePopover(
          anchor,
          { width: pop.offsetWidth, height: pop.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight }
        )
      );
    };

    measure();

    // Capture, because the chip may sit inside a scrolling container — a fixed
    // popover does not follow its anchor on its own.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, pending]);

  // Escape and outside clicks, both in the CAPTURE phase on purpose.
  //
  // PortalDrawer listens for Escape on document and calls router.back(), which
  // would close the whole drawer and throw away a half-typed note. Both
  // listeners sit on the same node, so stopPropagation from a bubble handler
  // would not reach it — capturing on document runs strictly earlier and stops
  // the event before the bubble phase exists at all.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (busy) return;
      // Escape from the confirm step goes back to the list rather than all the
      // way out, so a mis-click costs one keypress instead of the whole gesture.
      if (pending) {
        setPending(null);
        setNote('');
      } else {
        close();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (busy) return;
      const target = event.target as Node;
      // Two containment checks, not one. The popover is portalled to the body,
      // so it is no longer a DOM descendant of the chip — React routes its own
      // synthetic events through the component tree, but this listener is
      // native and sees only where the node actually lives.
      if (rootRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, pending, busy]);

  const current: BugReportStatus = isBugStatus(optimistic) ? optimistic : 'new';
  const chip = portalStatusChip(current);

  /** A reopen the app has not permitted. Enforced again by the route. */
  const blocked = (target: BugReportStatus) =>
    isReopenTransition(current, target) && !canReopen;

  /**
   * What this reporter is allowed to choose at all.
   *
   * Not the same question as `blocked`, which greys out a choice the reporter
   * can see and understand. These are the team's to set — a reporter offered
   * "Ready for Testing" would be offered the chance to declare their own bug
   * fixed, which is precisely the hole that let 26 reports go from New straight
   * to Resolved with no developer involved. They are absent rather than
   * disabled: a disabled row invites the question "why not me?", and the honest
   * answer is that it was never theirs.
   *
   * Mirrors canActorSetStatus('reporter', …) in the shared vocabulary, which is
   * what the API enforces. This list only decides what gets drawn.
   */
  const offered = SELECTABLE_BUG_STATUSES.filter((option: BugReportStatus) => {
    if (!canActorSetStatus('reporter', option)) return false;

    // Closing means "I tested it and it works", so it only appears once there
    // is a fix to have tested. applyStatusChange refuses it from anywhere else,
    // and a menu item that always fails is worse than no menu item.
    if (option === 'closed') {
      return canClose && current === 'ready_for_testing';
    }

    // Everything else is the broad power, which most applications leave off.
    // Without this the menu would offer New / Seen / In Progress to a reporter
    // whose every click the route then answers with a 403.
    return canSetAnyStatus;
  });

  const trimmedNote = note.trim();

  /**
   * Write the change.
   *
   * The menu closes before the request rather than after it. The chip has
   * already flipped to the new status and is spinning, which says more about
   * what is happening than a menu held open over it would — and on the immediate
   * path there is nothing left in the menu to look at. A refusal reverts the
   * chip and puts the server's own message in a toast.
   */
  const commit = async (target: BugReportStatus, reason?: string) => {
    if (busy) return;

    setBusy(true);
    const previous = optimistic;
    setOptimistic(target);
    close();

    try {
      const response = await fetch(
        `/api/portal/${appSlug}/${bugId}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: target,
            note: reason || undefined,
            reporter_email: reporterEmail,
            signature,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'That did not go through.');
      }

      toast.success(`Moved to ${bugStatusLabel(target)} — the team has been told`);
      router.refresh();
    } catch (error) {
      setOptimistic(previous);
      // The message comes from the API, which knows what actually failed.
      toast.error(
        error instanceof Error ? error.message : 'That did not go through.'
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * A choice from the menu.
   *
   * Reopens divert to the note step; everything else is written on the click.
   * The check is isReopenTransition rather than a list of statuses because the
   * route decides the same way, and two places deciding "is this a reopen" by
   * different rules is how a control starts producing 400s.
   */
  const choose = (target: BugReportStatus) => {
    if (isReopenTransition(current, target)) {
      setPending(target);
    } else {
      void commit(target);
    }
  };

  const popover = (
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: POPOVER_WIDTH,
        // Rendered before it is placed, because it has to be in the document to
        // be measurable. Hidden rather than absent so the first frame is not a
        // menu sitting in the top-left corner.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-[60] rounded-[10px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] p-1.5 shadow-[0_12px_32px_rgba(20,22,25,0.14)]"
    >
      {!pending ? (
        <ul role="listbox" aria-label="Status" className="m-0 list-none p-0">
          {offered.map((option: BugReportStatus) => {
            const isCurrent = option === current;
            const isBlocked = blocked(option);
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={isCurrent || isBlocked || busy}
                  onClick={() => choose(option)}
                  title={
                    isBlocked
                      ? 'This report is closed, and reopening is turned off for this application.'
                      : undefined
                  }
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-[var(--p-body)] transition-colors hover:bg-[#f4f4f2] disabled:cursor-not-allowed disabled:text-[var(--p-faint)] disabled:hover:bg-transparent"
                >
                  {BUG_STATUS_LABELS[option]}
                  {isCurrent && (
                    <Check className="h-3.5 w-3.5 text-[var(--p-muted)]" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        // Reopens only. Every other transition never reaches this branch, so
        // the copy can say what is actually happening instead of hedging
        // between a required reason and an optional aside.
        <div className="p-1.5">
          <p className="m-0 mb-2.5 text-[13px] text-[var(--p-second)]">
            {BUG_STATUS_LABELS[current]} →{' '}
            <span className="font-semibold text-[var(--p-ink)]">
              {BUG_STATUS_LABELS[pending]}
            </span>
          </p>

          <label
            htmlFor={noteId}
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-faint)]"
          >
            What is still wrong
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
            rows={3}
            autoFocus
            placeholder="Tell the team what is still going wrong…"
            className="min-h-[62px] w-full resize-y rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-2.5 py-2 text-[13px] text-[var(--p-ink)] outline-none transition-colors placeholder:text-[var(--p-faint)] focus:border-[#b8bcc4] focus:ring-[3px] focus:ring-black/5 disabled:bg-[var(--p-sunken)]"
          />

          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setNote('');
              }}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-3 text-[13px] font-medium text-[var(--p-second)] transition-colors hover:bg-[#f4f4f2] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commit(pending, trimmedNote)}
              disabled={busy || !trimmedNote}
              title={
                !trimmedNote ? 'Say what is still going wrong first' : undefined
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#17181b] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#17181b]"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Reopen report
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Change status — currently ${bugStatusLabel(current)}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md py-[3px] pl-[9px] pr-[6px] text-[12px] font-semibold outline-none transition-opacity hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-black/10"
        style={{ background: chip.bg, color: chip.fg }}
      >
        {BUG_STATUS_LABELS[current]}
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {open && createPortal(popover, popoverHost())}
    </div>
  );
}
