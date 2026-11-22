/**
 * What the subscription editor sends when the admin presses Save: only the
 * fields that differ from what the editor showed when it was opened.
 *
 * Why (22 Nov 2026): the Mac's feed can fill the plan and the start date after
 * the page was loaded. An editor that sent every field would send its old,
 * empty plan back and wipe what the feed had just filled, although the admin
 * only typed a fee. A field the admin did not touch is left out, and the
 * accounts route leaves a field that is left out alone. A field the admin
 * emptied is sent as null ("not known").
 *
 * Pure and free of imports, so the client component can use it and it can be
 * tested without a browser.
 */

/** The editor's five fields as text, the way the inputs hold them. */
export type SubscriptionFields = { plan: string; started: string; day: string; fee: string; note: string };

/** The body the accounts route takes: any of the five, null = not known. */
export type SubscriptionChanges = {
  plan_name?: string | null;
  subscription_started_on?: string | null;
  billing_day?: number | null;
  monthly_fee_inr?: number | null;
  billing_note?: string | null;
};

/** The inputs' text for the saved values: empty for "not known". */
export function subscriptionFields(saved: {
  planName: string | null;
  startedOn: string | null;
  billingDay: number | null;
  monthlyFee: number | null;
  note: string | null;
}): SubscriptionFields {
  return {
    plan: saved.planName ?? '',
    started: saved.startedOn ?? '',
    day: saved.billingDay == null ? '' : String(saved.billingDay),
    fee: saved.monthlyFee == null ? '' : String(saved.monthlyFee),
    note: saved.note ?? ''
  };
}

const textOf = (s: string) => s.trim() || null;
const numberOf = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * The fields that are not what they were when the editor was opened, as the
 * route wants them. Compared by meaning: "24000" and "24000.0" are the same
 * fee, and spaces around a text do not count. An empty result = nothing to save.
 */
export function subscriptionChanges(opened: SubscriptionFields, now: SubscriptionFields): SubscriptionChanges {
  const changes: SubscriptionChanges = {};
  if (textOf(now.plan) !== textOf(opened.plan)) changes.plan_name = textOf(now.plan);
  if (textOf(now.started) !== textOf(opened.started)) changes.subscription_started_on = textOf(now.started);
  if (numberOf(now.day) !== numberOf(opened.day)) changes.billing_day = numberOf(now.day);
  if (numberOf(now.fee) !== numberOf(opened.fee)) changes.monthly_fee_inr = numberOf(now.fee);
  if (textOf(now.note) !== textOf(opened.note)) changes.billing_note = textOf(now.note);
  return changes;
}
