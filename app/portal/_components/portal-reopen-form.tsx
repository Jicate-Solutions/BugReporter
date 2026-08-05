'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface PortalReopenFormProps {
  appSlug: string;
  bugId: string;
  reporterEmail: string;
  signature?: string;
}

/**
 * The reporter's right of reply to "we fixed it".
 *
 * Collapsed to a single button until it is wanted, because most people looking
 * at a resolved bug are there to confirm it is closed, not to argue. Opening it
 * asks for a reason and will not submit without one — "still broken" with no
 * detail sends the bug back to the team with nothing new to act on, and starts
 * the same loop again.
 *
 * The email is echoed back to the server rather than trusted from it: the
 * endpoint re-resolves the same identity check the page did, so this form cannot
 * grant access the page itself would not have granted.
 */
export function PortalReopenForm({
  appSlug,
  bugId,
  reporterEmail,
  signature,
}: PortalReopenFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/portal/${appSlug}/${bugId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          reporter_email: reporterEmail,
          signature,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Could not reopen this report.');
      }

      setReason('');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not reopen this report.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-4 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Is this still happening to you?
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            It&apos;s still broken
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2 border-t pt-4">
      <label htmlFor="reopen-reason" className="text-sm font-medium">
        What is still going wrong?
      </label>
      <p className="text-muted-foreground text-xs">
        This goes straight to the team along with your report. The more specific
        you can be, the faster they can act on it.
      </p>
      <Textarea
        id="reopen-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="It still fails when I…"
        rows={3}
        autoFocus
        disabled={submitting}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !reason.trim()}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Reopen this report
        </Button>
      </div>
    </form>
  );
}
