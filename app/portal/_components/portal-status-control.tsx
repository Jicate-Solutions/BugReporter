'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  bugStatusLabel,
  isBugStatus,
  isReopenTransition,
  type BugReportStatus,
} from '@boobalan_jkkn/shared';
import { portalStatusChip } from './portal-status-badge';

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
}

/**
 * The status chip, when the reporter is allowed to change it.
 *
 * Two deliberate departures from the dashboard's inline status select:
 *
 * It does not write on selection. Picking a status opens a confirm step with a
 * note field instead. A reporter's status change emails the app owner and fires
 * a webhook, and there is no undo on this side of the portal — the second click
 * is worth it. On a phone the native <select> this replaces would be a wheel
 * picker whose onChange fires on every value scrolled past, which is the worst
 * possible input for something that sends mail.
 *
 * And it renders as a chip, not a form control. At rest it is pixel-identical to
 * PortalStatusBadge apart from the chevron, so the list and the detail header do
 * not look like two different applications.
 */
export function PortalStatusControl({
  appSlug,
  bugId,
  status,
  reporterEmail,
  signature,
  canReopen,
}: PortalStatusControlProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const [optimistic, setOptimistic] = useState(status);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<BugReportStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // The server is the authority. Without this, a change that failed and was
  // retried can leave the chip showing a status the server never accepted.
  useEffect(() => {
    setOptimistic(status);
  }, [status]);

  const close = () => {
    setOpen(false);
    setPending(null);
    setNote('');
  };

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
      if (rootRef.current?.contains(event.target as Node)) return;
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

  const noteRequired = pending ? isReopenTransition(current, pending) : false;
  const trimmedNote = note.trim();

  const submit = async () => {
    if (!pending || busy) return;
    if (noteRequired && !trimmedNote) return;

    setBusy(true);
    const previous = optimistic;
    setOptimistic(pending);

    try {
      const response = await fetch(
        `/api/portal/${appSlug}/${bugId}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: pending,
            note: trimmedNote || undefined,
            reporter_email: reporterEmail,
            signature,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'That did not go through.');
      }

      toast.success(`Moved to ${bugStatusLabel(pending)} — the team has been told`);
      close();
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

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[268px] rounded-[10px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] p-1.5 shadow-[0_12px_32px_rgba(20,22,25,0.14)]">
          {!pending ? (
            <ul role="listbox" aria-label="Status" className="m-0 list-none p-0">
              {BUG_STATUSES.map((option) => {
                const isCurrent = option === current;
                const isBlocked = blocked(option);
                return (
                  <li key={option}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      disabled={isCurrent || isBlocked}
                      onClick={() => setPending(option)}
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
            <div className="p-1.5">
              <p className="m-0 mb-2.5 text-[13px] text-[var(--p-second)]">
                {BUG_STATUS_LABELS[current]} →{' '}
                <span className="font-semibold text-[var(--p-ink)]">
                  {BUG_STATUS_LABELS[pending]}
                </span>
              </p>

              <label
                htmlFor="portal-status-note"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-faint)]"
              >
                {noteRequired ? 'What is still wrong' : 'Anything to add?'}
              </label>
              <textarea
                id="portal-status-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
                rows={3}
                autoFocus
                placeholder={
                  noteRequired
                    ? 'Tell the team what is still going wrong…'
                    : 'Optional — anything the team should know'
                }
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
                  onClick={submit}
                  disabled={busy || (noteRequired && !trimmedNote)}
                  title={
                    noteRequired && !trimmedNote
                      ? 'Say what is still going wrong first'
                      : undefined
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#17181b] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#17181b]"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Update status
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
