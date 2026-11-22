'use client';

/**
 * Subscription details for one Claude account: plan name, start date, the day
 * of the month it renews, the monthly fee and a note. Platform admins only.
 * The Mac's feed fills the plan and the start date when they are empty; the
 * rest Claude does not report, so it is typed in here. What is typed here is
 * never changed by the feed. Folded away behind
 * "edit subscription" so the card stays short on a phone. Saves through the
 * accounts PATCH route, which never touches the key.
 *
 * Save sends ONLY the fields changed since the editor was opened, and every
 * opening starts from the values the page has now. So a plan the feed filled
 * in after the page was loaded is not wiped by an admin who only types a fee.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { subscriptionChanges, subscriptionFields, type SubscriptionFields } from '@/lib/ai-engine/subscription-edit';

export function AccountSubscriptionEditor({
  label,
  today,
  planName,
  startedOn,
  billingDay,
  monthlyFee,
  note
}: {
  label: string;
  /** Today's date in India, "YYYY-MM-DD": a start date cannot be later. */
  today: string;
  planName: string | null;
  startedOn: string | null;
  billingDay: number | null;
  monthlyFee: number | null;
  note: string | null;
}) {
  const router = useRouter();
  const saved = () => subscriptionFields({ planName, startedOn, billingDay, monthlyFee, note });
  /** What the fields showed when the editor was opened; null while it is closed. Save compares against it. */
  const [opened, setOpened] = useState<SubscriptionFields | null>(null);
  const [plan, setPlan] = useState(planName ?? '');
  const [started, setStarted] = useState(startedOn ?? '');
  const [day, setDay] = useState(billingDay == null ? '' : String(billingDay));
  const [fee, setFee] = useState(monthlyFee == null ? '' : String(monthlyFee));
  const [text, setText] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  /** Open: start from what the page has now, never from what it had when it was first drawn or from old typing. */
  function open() {
    const now = saved();
    setPlan(now.plan);
    setStarted(now.started);
    setDay(now.day);
    setFee(now.fee);
    setText(now.note);
    setOpened(now);
  }

  if (!opened) {
    return (
      <button type="button" className="text-muted-foreground text-xs underline" onClick={open}>
        edit subscription
      </button>
    );
  }
  const baseline = opened;
  /** Cancel: typing that was not saved is dropped; the next opening starts from what is saved. */
  const cancel = () => setOpened(null);

  async function save() {
    const dayNumber = day.trim() === '' ? null : Number(day);
    if (dayNumber !== null && (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31)) {
      toast.error('The billing day is a whole number from 1 to 31, or leave it empty.');
      return;
    }
    const feeNumber = fee.trim() === '' ? null : Number(fee);
    if (feeNumber !== null && (!Number.isFinite(feeNumber) || feeNumber < 0)) {
      toast.error('The monthly fee is a number in rupees, or leave it empty.');
      return;
    }
    if (started && started > today) {
      toast.error('The start date cannot be in the future.');
      return;
    }
    // Only what changed since the editor was opened goes out; a field left alone is not sent, so it is not touched.
    const changes = subscriptionChanges(baseline, { plan, started, day, fee, note: text });
    if (Object.keys(changes).length === 0) {
      toast.info(`${label}: nothing changed.`);
      setOpened(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, subscription: changes })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success(`${label}: subscription details saved.`);
      setOpened(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const id = (field: string) => `sub-${label}-${field}`;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">
        Subscription for {label}. Leave any of these empty when you do not know it. Leave the
        billing day empty to go by the start date. An empty field means &quot;not known&quot;: the plan
        and the start date may then be filled in from the Mac.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={id('plan')}>Plan</Label>
          <Input
            id={id('plan')}
            className="h-8 w-32"
            placeholder="Max 20x"
            maxLength={60}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={id('started')}>Started on</Label>
          <Input
            id={id('started')}
            type="date"
            className="h-8 w-40"
            max={today}
            value={started}
            onChange={(e) => setStarted(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={id('day')}>Billing day</Label>
          <Input
            id={id('day')}
            className="h-8 w-16"
            inputMode="numeric"
            placeholder="5"
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={id('fee')}>Monthly fee (Rs)</Label>
          <Input
            id={id('fee')}
            className="h-8 w-28"
            inputMode="decimal"
            placeholder="24000"
            value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, '').slice(0, 11))}
          />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label className="text-xs" htmlFor={id('note')}>Note</Label>
          <Input
            id={id('note')}
            className="h-8"
            maxLength={300}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save subscription'}
        </Button>
        <Button size="sm" variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
