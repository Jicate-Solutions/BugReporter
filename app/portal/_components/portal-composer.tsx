'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

interface PortalComposerProps {
  appSlug: string;
  bugId: string;
  reporterEmail: string;
  signature?: string;
  allowNotes: boolean;
  canReopen: boolean;
}

/**
 * One box, two things to do with what you wrote.
 *
 * Reply and reopen used to be separate forms with separate text areas, which
 * made a reporter choose which one they were doing before they had written
 * anything. They are the same act — you type what is happening, then decide
 * whether it is an update or a disagreement.
 *
 * A reopen requires a reason, and this is where that requirement stops being
 * bureaucratic: the reason is simply the note you were already writing. The
 * reopen action is disabled until there is text, and says why.
 */
export function PortalComposer({
  appSlug,
  bugId,
  reporterEmail,
  signature,
  allowNotes,
  canReopen,
}: PortalComposerProps) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'note' | 'reopen'>(null);

  const trimmed = text.trim();
  const submitting = busy !== null;

  const send = async (kind: 'note' | 'reopen') => {
    if (!trimmed || submitting) return;
    setBusy(kind);

    const endpoint =
      kind === 'reopen'
        ? `/api/portal/${appSlug}/${bugId}/reopen`
        : `/api/portal/${appSlug}/${bugId}/notes`;

    const payload =
      kind === 'reopen'
        ? { reason: trimmed, reporter_email: reporterEmail, signature }
        : { message: trimmed, reporter_email: reporterEmail, signature };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'That did not go through.');
      }

      setText('');
      toast.success(
        kind === 'reopen'
          ? 'Reopened — the team has been told'
          : 'Note sent to the team'
      );
      router.refresh();
    } catch (error) {
      // The message comes from the API, which knows what actually failed.
      toast.error(
        error instanceof Error ? error.message : 'That did not go through.'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 border-t border-[var(--p-line-soft)] pt-4">
      <label htmlFor="portal-composer" className="sr-only">
        Add a note for the team
      </label>
      <textarea
        id="portal-composer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={submitting || !allowNotes}
        rows={3}
        placeholder={
          allowNotes
            ? canReopen
              ? 'Add a note, or say what is still going wrong…'
              : 'Add a note or more detail…'
            : 'Replies are turned off for this application.'
        }
        className="min-h-[62px] w-full resize-y rounded-[10px] border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-[13px] py-[11px] text-[13.5px] text-[var(--p-ink)] outline-none transition-colors placeholder:text-[var(--p-faint)] focus:border-[#b8bcc4] focus:ring-[3px] focus:ring-black/5 disabled:bg-[var(--p-sunken)]"
      />

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {canReopen && (
          <button
            type="button"
            onClick={() => send('reopen')}
            disabled={submitting || !trimmed}
            title={
              trimmed
                ? 'Send this back to the team as still broken'
                : 'Say what is still going wrong first'
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--p-line-ctrl)] bg-[var(--p-card)] px-[13px] text-[13px] font-medium text-[var(--p-second)] transition-colors hover:bg-[#f4f4f2] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--p-card)]"
          >
            {busy === 'reopen' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            It&apos;s still broken
          </button>
        )}

        <button
          type="button"
          onClick={() => send('note')}
          disabled={submitting || !trimmed || !allowNotes}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#17181b] px-[15px] text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#17181b]"
        >
          {busy === 'note' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Send note
        </button>
      </div>
    </div>
  );
}
