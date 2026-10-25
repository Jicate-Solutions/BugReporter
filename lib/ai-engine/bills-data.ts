/**
 * Monthly AI bill per app — server-side reads, scoped by role.
 *
 * Who sees what (Director, 24 Oct 2026):
 *   - Super admins and the organisation's owner / admin: every app's bill,
 *     plus the runs that belong to no app.
 *   - Everyone else (an org developer, an app maintainer / developer /
 *     viewer): only the apps they are a member of (application_members).
 *     Never another app's runs or bill, and never the runs with no app.
 *
 * Every function takes the service-role client, so the scoping here IS the
 * access rule; callers pass the signed-in user's id.
 *
 * SINGLE-ORG ASSUMPTION: runs with no app (application_id NULL, e.g. the
 * Control Tower's own account probes) also have no organisation today, so
 * the org admin view counts NULL-organisation runs as this organisation's.
 * Before a second organisation joins, decide who those runs belong to.
 *
 * Works before 20261025_ai_billing_clients.sql is applied: every app is then
 * "No client linked" (0% discount) and `clientsReady` is false.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  billTotals,
  buildBillLines,
  currentIstMonth,
  istMonthRange,
  type BillApp,
  type BillClient,
  type BillLine,
  type BillTotals,
  type BillUsageRow
} from '@/lib/ai-engine/billing';
import { loadActor, type Actor } from '@/lib/ai-engine/task-builder';

const ORG_ADMIN_ROLES = new Set(['owner', 'admin']);
const PAGE = 1000; // PostgREST's row cap per request

/** A usage row with the extra columns the usage page slices by. */
export interface LedgerRow extends BillUsageRow {
  job_type: string;
  model_id: string | null;
  account: string | null;
  organization_id: string | null;
}

export function isOrgBillAdmin(actor: Actor, organizationId: string): boolean {
  return actor.superAdmin || ORG_ADMIN_ROLES.has(actor.orgRoles.get(organizationId) ?? '');
}

export interface BillScope {
  /** true = all of the org's apps and the runs with no app */
  orgAdmin: boolean;
  /** the apps whose bills this user may see */
  apps: BillApp[];
}

/** Pure: which of the org's apps a user may see bills for. */
export function billScope(actor: Actor, organizationId: string, orgApps: BillApp[]): BillScope {
  if (isOrgBillAdmin(actor, organizationId)) return { orgAdmin: true, apps: orgApps };
  return { orgAdmin: false, apps: orgApps.filter((a) => actor.appRoles.has(a.id)) };
}

/** The org's apps with their client link, and its billing clients. */
export async function readBillingSetup(
  admin: SupabaseClient,
  organizationId: string
): Promise<{ apps: BillApp[]; clients: BillClient[]; clientsReady: boolean }> {
  const withLink = await admin
    .from('applications')
    .select('id, name, slug, billing_client_id')
    .eq('organization_id', organizationId)
    .order('name');
  if (withLink.error) {
    // billing_client_id not there yet: migration not applied.
    const { data } = await admin
      .from('applications')
      .select('id, name, slug')
      .eq('organization_id', organizationId)
      .order('name');
    return {
      apps: ((data ?? []) as Omit<BillApp, 'billing_client_id'>[]).map((a) => ({ ...a, billing_client_id: null })),
      clients: [],
      clientsReady: false
    };
  }
  const { data: clients, error } = await admin
    .from('ai_billing_clients')
    .select('myjkkn_client_id, name_cached, discount_pct')
    .eq('organization_id', organizationId)
    .order('name_cached');
  return {
    apps: (withLink.data ?? []) as BillApp[],
    clients: error
      ? []
      : ((clients ?? []) as BillClient[]).map((c) => ({ ...c, discount_pct: Number(c.discount_pct) })),
    clientsReady: !error
  };
}

const LEDGER_COLS =
  'application_id, app_slug, organization_id, success, is_test, api_cost_usd, invoked_at, job_type, model_id, account';

/**
 * Ledger rows in [start, end) for the given apps (and, for an org admin, the
 * runs with no app). Paged past PostgREST's 1000-row cap.
 */
export async function readLedger(
  admin: SupabaseClient,
  opts: {
    organizationId: string;
    start: string;
    end: string;
    appIds: string[];
    includeNoApp: boolean;
  }
): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  async function drain(filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await filter(base()).range(from, from + PAGE - 1);
      if (error) throw new Error(`ai_usage read failed: ${error.message}`);
      out.push(...((data ?? []) as unknown as LedgerRow[]));
      if (!data || data.length < PAGE) return;
    }
  }
  function base() {
    return admin
      .from('ai_usage')
      .select(LEDGER_COLS)
      .gte('invoked_at', opts.start)
      .lt('invoked_at', opts.end)
      .order('invoked_at', { ascending: true })
      .order('id', { ascending: true });
  }
  if (opts.appIds.length) await drain((q) => q.in('application_id', opts.appIds));
  if (opts.includeNoApp) {
    await drain((q) =>
      q.is('application_id', null).or(`organization_id.is.null,organization_id.eq.${opts.organizationId}`)
    );
  }
  return out;
}

export interface OrgBills {
  month: string;
  scope: BillScope;
  clients: BillClient[];
  clientsReady: boolean;
  lines: BillLine[];
  totals: BillTotals;
}

/** The Bills view: one line per visible app (and no-app runs for admins) for one IST month. */
export async function loadOrgBills(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  month: string
): Promise<OrgBills> {
  const [actor, setup] = await Promise.all([loadActor(admin, userId), readBillingSetup(admin, organizationId)]);
  const scope = billScope(actor, organizationId, setup.apps);
  const { start, end } = istMonthRange(month);
  const rows = await readLedger(admin, {
    organizationId,
    start,
    end,
    appIds: scope.apps.map((a) => a.id),
    includeNoApp: scope.orgAdmin
  });
  const lines = buildBillLines(rows, setup.apps, setup.clients);
  // An app with no runs still gets a row, so the team sees "nothing this month".
  const seen = new Set(lines.map((l) => l.application_id));
  for (const a of scope.apps) {
    if (seen.has(a.id)) continue;
    const client = setup.clients.find((c) => c.myjkkn_client_id === a.billing_client_id);
    lines.push({
      key: `${month}|app:${a.id}`,
      month,
      application_id: a.id,
      app_slug: a.slug,
      app_name: a.name,
      billed_to_app: true,
      client_id: client?.myjkkn_client_id ?? null,
      client_name: client?.name_cached ?? null,
      runs: 0,
      billable_runs: 0,
      test_runs: 0,
      failed_runs: 0,
      unpriced_runs: 0,
      api_usd: 0,
      discount_pct: client ? Number(client.discount_pct) || 0 : 0,
      billed_usd: 0,
      billed_inr: 0
    });
  }
  const billed = lines.filter((l) => l.billed_to_app);
  return {
    month,
    scope,
    clients: setup.clients,
    clientsReady: setup.clientsReady,
    lines,
    totals: billTotals(billed)
  };
}

export type AppBill =
  | { visible: false }
  | { visible: true; month: string; line: BillLine | null; clientsReady: boolean };

/** Month-to-date bill for one app, or { visible: false } if this user may not see it. */
export async function loadAppMonthToDate(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  applicationId: string,
  now: Date
): Promise<AppBill> {
  const [actor, setup] = await Promise.all([loadActor(admin, userId), readBillingSetup(admin, organizationId)]);
  const scope = billScope(actor, organizationId, setup.apps);
  if (!scope.apps.some((a) => a.id === applicationId)) return { visible: false };
  const month = currentIstMonth(now);
  const { start, end } = istMonthRange(month);
  const rows = await readLedger(admin, {
    organizationId,
    start,
    end,
    appIds: [applicationId],
    includeNoApp: false
  });
  const [line] = buildBillLines(rows, setup.apps, setup.clients);
  return { visible: true, month, line: line ?? null, clientsReady: setup.clientsReady };
}
