'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface PortalReplyFormProps {
  appSlug: string;
  bugId: string;
  reporterEmail: string;
  signature?: string;
}

/**
 * Lets a reporter reply on their own bug.
 *
 * The reporter email is echoed back to the server rather than trusted from it —
 * the endpoint re-resolves the same identity check the page did, so this form
 * cannot grant access the page itself would not have granted.
 */
export function PortalReplyForm({
  appSlug,
  bugId,
  reporterEmail,
  signature,
}: PortalReplyFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/portal/${appSlug}/${bugId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          reporter_email: reporterEmail,
          signature,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Could not send your note.');
      }

      setMessage('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Add a note for the team…"
        rows={3}
        disabled={submitting}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting || !message.trim()}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send note
        </Button>
      </div>
    </form>
  );
}
