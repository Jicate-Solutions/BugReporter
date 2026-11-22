/**
 * What each Claude subscription costs and when it renews, for the accounts card.
 *
 * Why (Director, 21 Nov 2026): each Claude Max subscription renews by itself
 * every month on the day it started, and Claude does not report the next
 * payment date or the amount. So a platform admin types the details in on the
 * card (plan, start date, the day it renews when known, the monthly fee, a
 * note) and the card works the dates out.
 *
 * Dates here are calendar days in India, "YYYY-MM-DD". They are never run
 * through a clock: the caller says what "today" is (istToday).
 *
 * The functions down to `subscriptionSchema` are pure. `readSubscriptions`
 * touches the database and never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkBlocksUse, type CheckKind } from '@/lib/ai-engine/accounts';
import { dateParts, dayMonth, daysBetween, daysInMonth } from '@/lib/ai-engine/india-time';

/** The subscription details an admin types in. Each one may be unknown. */
export type Subscription = {
  plan_name: string | null;
  /** The day the subscription started, "YYYY-MM-DD". */
  subscription_started_on: string | null;
  /** The day of the month it renews (1 to 31), when the admin knows it. */
  billing_day: number | null;
  monthly_fee_inr: number | null;
  /** Whether paid extra use is switched on; null = not known. */
  extra_usage_on: boolean | null;
  billing_note: string | null;
};

export type Renewal = {
  /** The next renewal date, "YYYY-MM-DD". Today counts, except on the day the subscription started. */
  date: string;
  /** The day of the month it renews on (the 31st renews on the last day of a shorter month). */
  day: number;
  /** True when the billing day was entered; false when it is taken from the start date. */
  confirmed: boolean;
};

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The next renewal on or after `today`. The day comes from the billing day
 * when entered ("confirmed"), else from the day of the start date
 * ("estimated"). A month shorter than that day renews on its last day: the
 * 31st renews on 30 Nov and on 28 or 29 Feb. null when neither is known.
 * Today counts as a renewal day, except on the very day the subscription
 * started: it was paid for today, so its first renewal is next month.
 */
export function nextRenewal(
  sub: Pick<Subscription, 'billing_day' | 'subscription_started_on'>,
  today: string
): Renewal | null {
  const now = dateParts(today);
  const entered = sub.billing_day != null && sub.billing_day >= 1 && sub.billing_day <= 31 ? sub.billing_day : null;
  const day = entered ?? dateParts(sub.subscription_started_on)?.d ?? null;
  if (!now || day == null) return null;

  const dayIn = (y: number, m: number) => Math.min(day, daysInMonth(y, m));
  let { y, m } = now;
  const started = dateParts(sub.subscription_started_on);
  const startedToday = started !== null && started.y === now.y && started.m === now.m && started.d === now.d;
  if (dayIn(y, m) < now.d || (startedToday && dayIn(y, m) === now.d)) {
    // This month's renewal has passed (or is the first payment itself): next month, which in December is January of next year.
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { date: `${y}-${two(m)}-${two(dayIn(y, m))}`, day, confirmed: entered != null };
}

export type RenewalDue = { label: string; date: string; confirmed: boolean; fee: number | null };

/**
 * The renewals that fall in the next `days` days, today and the last day both
 * counted, in date order. `total` adds up the monthly fees that are known;
 * an account with no fee entered is listed (fee null) and left out of the
 * total, and counted in `feesMissing`.
 */
export function renewalsDue(
  accounts: ({ label: string } & Subscription)[],
  today: string,
  days = 30
): { items: RenewalDue[]; total: number; feesMissing: number } {
  const items = accounts
    .map((a) => ({ label: a.label, renewal: nextRenewal(a, today), fee: a.monthly_fee_inr }))
    .filter((a): a is { label: string; renewal: Renewal; fee: number | null } => {
      if (!a.renewal) return false;
      const away = daysBetween(today, a.renewal.date);
      return away >= 0 && away <= days;
    })
    .map((a) => ({ label: a.label, date: a.renewal.date, confirmed: a.renewal.confirmed, fee: a.fee }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return {
    items,
    total: items.reduce((sum, i) => sum + (i.fee ?? 0), 0),
    feesMissing: items.filter((i) => i.fee == null).length
  };
}

/** "Rs 24,000", grouped the Indian way ("Rs 1,20,000"). */
export function rupees(n: number): string {
  const [whole, paise] = (Math.round(n * 100) / 100).toString().split('.');
  const head = whole.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return `Rs ${grouped}${paise ? `.${paise.padEnd(2, '0')}` : ''}`;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st", "31st". */
function nth(day: number): string {
  const tail = day % 100 >= 11 && day % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th');
  return `${day}${tail}`;
}

/** A date for a sentence: "5 Dec", with the year only when it is not this year. */
function shortDate(date: string, today: string): string {
  return dayMonth(date, dateParts(date)?.y !== dateParts(today)?.y);
}

export const NO_SUBSCRIPTION_DETAILS = 'Subscription details not entered yet.';

/**
 * One line for an account row, with only the parts that are known:
 * "Max 20x · started 5 Mar 2024 · renews on the 5th (estimated from the start
 * date) · next 5 Dec · Rs 24,000 a month · paid extra use off".
 */
export function subscriptionLine(sub: Subscription, today: string): string {
  const parts: string[] = [];
  if (sub.plan_name) parts.push(sub.plan_name);
  if (dateParts(sub.subscription_started_on)) parts.push(`started ${dayMonth(sub.subscription_started_on as string, true)}`);
  const renewal = nextRenewal(sub, today);
  if (renewal) {
    parts.push(`renews on the ${nth(renewal.day)}${renewal.confirmed ? '' : ' (estimated from the start date)'}`);
    parts.push(renewal.date === today ? 'renews today' : `next ${shortDate(renewal.date, today)}`);
  }
  if (sub.monthly_fee_inr != null) parts.push(`${rupees(sub.monthly_fee_inr)} a month`);
  if (sub.extra_usage_on != null) parts.push(`paid extra use ${sub.extra_usage_on ? 'on' : 'off'}`);
  if (sub.billing_note) parts.push(`note: ${sub.billing_note}`);
  return parts.length ? parts.join(' · ') : NO_SUBSCRIPTION_DETAILS;
}

/** One line of the "Renewals in the next 30 days" block: "5 Dec · aiahs · Rs 24,000". */
export function renewalLine(r: RenewalDue, today: string): string {
  const when = r.date === today ? 'Today' : shortDate(r.date, today);
  return `${when}${r.confirmed ? '' : ' (estimated)'} · ${r.label} · ${r.fee == null ? 'fee not entered' : rupees(r.fee)}`;
}

/** The last line of that block: what the listed renewals add up to. */
export function renewalsTotalLine(due: { total: number; feesMissing: number }): string {
  const missing =
    due.feesMissing === 0
      ? ''
      : ` ${due.feesMissing === 1 ? 'One account has' : `${due.feesMissing} accounts have`} no fee entered and ${due.feesMissing === 1 ? 'is' : 'are'} left out.`;
  return `Total: ${rupees(due.total)}.${missing}`;
}

export const PAID_BUT_UNUSABLE = 'Paid for, but the boxes cannot use it now.';

/**
 * The one flag: an account whose last check says its key is rejected or its
 * organisation blocks it, and that has a monthly fee entered. Money is going
 * out for an account no box can use.
 */
export function paidButUnusable(check: CheckKind | undefined, sub: Subscription | undefined): boolean {
  return check !== undefined && checkBlocksUse(check) && (sub?.monthly_fee_inr ?? 0) > 0;
}

// ── saving (the accounts route) and reading (the page) ───────────────────────

/** "" and spaces only mean "not known". */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => v?.trim() || null);

/**
 * What the subscription editor may send. Every field must be there (null =
 * not known), nothing else is accepted, and the key is not part of it.
 * `today` is checked by the route: a start date cannot be in the future.
 */
export const subscriptionSchema = z
  .object({
    plan_name: text(60),
    subscription_started_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => dateParts(d) !== null && d >= '2000-01-01', 'not a real date')
      .nullable(),
    billing_day: z.number().int().min(1).max(31).nullable(),
    monthly_fee_inr: z
      .number()
      .min(0)
      .max(10_000_000)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'at most 2 decimals')
      .nullable(),
    billing_note: text(300)
  })
  .strict();

const SUBSCRIPTION_COLUMNS =
  'label, plan_name, subscription_started_on, billing_day, monthly_fee_inr, extra_usage_on, billing_note';

/**
 * Every account's subscription details, by label. null when they cannot be
 * read, which is the case until the columns exist (the migration is applied
 * separately): the card then shows no subscription line and no editor, and
 * everything else on it works as before. This is a read of its own on
 * purpose: adding these columns to the main accounts read would empty the
 * whole card while they are missing. Never throws.
 */
export async function readSubscriptions(admin: SupabaseClient): Promise<Map<string, Subscription> | null> {
  try {
    const { data, error } = await admin.from('ai_accounts').select(SUBSCRIPTION_COLUMNS);
    if (error) return null;
    const rows = (data ?? []) as unknown as ({ label: string } & Record<keyof Subscription, unknown>)[];
    return new Map(
      rows.map((r) => [
        r.label,
        {
          plan_name: (r.plan_name as string | null) ?? null,
          subscription_started_on: (r.subscription_started_on as string | null) ?? null,
          billing_day: r.billing_day == null ? null : Number(r.billing_day),
          monthly_fee_inr: r.monthly_fee_inr == null ? null : Number(r.monthly_fee_inr),
          extra_usage_on: (r.extra_usage_on as boolean | null) ?? null,
          billing_note: (r.billing_note as string | null) ?? null
        }
      ])
    );
  } catch {
    return null;
  }
}
