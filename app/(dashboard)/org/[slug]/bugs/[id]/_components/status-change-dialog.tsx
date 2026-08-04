'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { BugStatusBadge } from '../../_components/bug-status-badge';
import { bugStatusLabel } from '@boobalan_jkkn/shared';

interface StatusChangeDialogProps {
  open: boolean;
  fromStatus: string;
  toStatus: string | null;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void | Promise<void>;
}

/**
 * Captures the "why" alongside the "what" when a developer changes a status.
 *
 * The note is not internal — it lands on the bug's thread and is what the
 * reporter sees in their portal. That is the entire point of the feature, so
 * the dialog says so explicitly rather than leaving the developer to guess who
 * is going to read what they type.
 */
export function StatusChangeDialog({
  open,
  fromStatus,
  toStatus,
  submitting,
  onCancel,
  onConfirm,
}: StatusChangeDialogProps) {
  const [note, setNote] = useState('');

  const handleOpenChange = (next: boolean) => {
    if (!next && !submitting) {
      setNote('');
      onCancel();
    }
  };

  const handleConfirm = async () => {
    await onConfirm(note.trim());
    setNote('');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Update status</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-2 pt-1">
              <BugStatusBadge status={fromStatus} />
              <span className="text-muted-foreground">&rarr;</span>
              {toStatus && <BugStatusBadge status={toStatus} />}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="status-note">Note (optional)</Label>
          <Textarea
            id="status-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              toStatus === 'wont_fix'
                ? "Explain why this won't be fixed…"
                : 'What changed? Anything the reporter should know?'
            }
            rows={4}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Saved to the bug&apos;s thread and shown to the reporter, along with
            the status update email.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !toStatus}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set to {toStatus ? bugStatusLabel(toStatus) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
