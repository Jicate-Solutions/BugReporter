'use client';

/**
 * Subscription details for one Claude account: plan name, start date, the day
 * of the month it renews, the monthly fee and a note. Platform admins only.
 * Claude does not report these, so they are typed in here. Folded away behind
 * "edit subscription" so the card stays short on a phone. Saves through the
 * accounts PATCH route, which never touches the key.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(planName ?? '');
  const [started, setStarted] = useState(startedOn ?? '');
  const [day, setDay] = useState(billingDay == null ? '' : String(billingDay));
  const [fee, setFee] = useState(monthlyFee == null ? '' : String(monthlyFee));
  const [text, setText] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  /** Cancel: put back what is saved, so typing that was not saved never looks saved the next time. */
  function cancel() {
    setPlan(planName ?? '');
    setStarted(startedOn ?? '');
    setDay(billingDay == null ? '' : String(billingDay));
    setFee(monthlyFee == null ? '' : String(monthlyFee));
    setText(note ?? '');
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setOpen(true)}>
        edit subscription
      </button>
    );
  }

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
    setSaving(true);
    try {
      const res = await fetch('/api/internal/ai-engine/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          subscription: {
            plan_name: plan.trim() || null,
            subscription_started_on: started || null,
            billing_day: dayNumber,
            monthly_fee_inr: feeNumber,
            billing_note: text.trim() || null
          }
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Could not save the change.');
        return;
      }
      toast.success(`${label}: subscription details saved.`);
      setOpen(false);
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
        billing day empty to go by the start date.
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
