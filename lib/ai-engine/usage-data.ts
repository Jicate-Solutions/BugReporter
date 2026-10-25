/**
 * AI usage page — server-side read, scoped by role (same rule as the bills:
 * lib/ai-engine/bills-data.ts). Org owners / admins and super admins see every
 * app and the runs with no app; anyone else sees only the apps they are on.
 *
 * The cost allocation needs every run on each account in each month touched
 * (lib/ai-engine/usage-report.ts), so this reads the whole months for the
 * whole organisation, works out the shares, and only then cuts the rows down
 * to the dates picked and to what the viewer may see. The viewer only ever
 * receives the cut rows' sums.
 *
 * SINGLE-ORG ASSUMPTION (as in bills-data.ts): a Claude account serves every
 * organisation, but only this organisation's runs (plus the runs with no
 * organisation) are read for the shares. With one organisation that is every
 * run; revisit when a second one joins.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { istMonthRange } from '@/lib/ai-engine/billing';
import { billScope, readBillingSetup, readLedger, type BillScope } from '@/lib/ai-engine/bills-data';
import { loadActor } from '@/lib/ai-engine/task-builder';
import {
  accountMonthSummary,
  accountMonthTotals,
  buildUsageSlices,
  istDayRange,
  monthsTouched,
  type AccountMonth,
  type UsageDimension,
  type UsageSlice
} from '@/lib/ai-engine/usage-report';

export interface UsageReport {
  scope: BillScope;
  clientsReady: boolean;
  slices: UsageSlice[];
  total: UsageSlice;
  /** org admins only: each account's monthly cost and what is unallocated */
  accounts: AccountMonth[] | null;
}

export async function loadUsageReport(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  opts: { from: string; to: string; dimension: UsageDimension }
): Promise<UsageReport> {
  const [actor, setup] = await Promise.all([loadActor(admin, userId), readBillingSetup(admin, organizationId)]);
  const scope = billScope(actor, organizationId, setup.apps);

  const months = monthsTouched(opts.from, opts.to);
  const all = await readLedger(admin, {
    organizationId,
    start: istMonthRange(months[0]).start,
    end: istMonthRange(months[months.length - 1]).end,
    appIds: setup.apps.map((a) => a.id),
    includeNoApp: true
  });
  const totals = accountMonthTotals(all);

  const { start, end } = istDayRange(opts.from, opts.to);
  const [from, to] = [Date.parse(start), Date.parse(end)];
  const visible = new Set(scope.apps.map((a) => a.id));
  const rows = all.filter((r) => {
    const t = Date.parse(r.invoked_at);
    return (
      t >= from &&
      t < to &&
      (scope.orgAdmin || (r.application_id != null && visible.has(r.application_id)))
    );
  });
  const { slices, total } = buildUsageSlices(rows, totals, setup.apps, setup.clients, opts.dimension);

  let accounts: AccountMonth[] | null = null;
  if (scope.orgAdmin) {
    const { data } = await admin.from('ai_accounts').select('label').order('label');
    const labels = new Set(((data ?? []) as { label: string }[]).map((a) => a.label));
    for (const r of all) if (r.account) labels.add(r.account);
    accounts = accountMonthSummary(totals, [...labels].sort(), months);
  }

  return { scope, clientsReady: setup.clientsReady, slices, total, accounts };
}
