/**
 * AI Bills — each app's monthly AI bill (Director's decisions, 24 Oct 2026).
 *
 *   Bill = Claude API price of the app's runs in the month (ai_usage.api_cost_usd)
 *          minus the discount of the app's client. Failed runs are not billed;
 *          test runs are. Runs with no recorded price are counted as
 *          "unpriced", not as $0. Months are India-time calendar months.
 *
 * Org owners / admins and platform admins see every app, the runs with no app,
 * and can link apps to clients and set discounts. Everyone else sees only the
 * apps they are on the team of. The rules live in lib/ai-engine/bills-data.ts
 * and lib/ai-engine/billing.ts; INR uses USD_TO_INR_ASSUMED (an assumption).
 *
 * Server component. Membership is checked session-side (RLS), then data is
 * read with the service client and scoped by role.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  USD_TO_INR_ASSUMED,
  currentIstMonth,
  formatInr,
  formatUsd,
  isMonthKey,
  monthLabel,
  recentMonths,
  usdToInr
} from '@/lib/ai-engine/billing';
import { loadOrgBills } from '@/lib/ai-engine/bills-data';
import { MonthPicker } from './_components/month-picker';
import { AddClientForm, AppClientSelect, ClientDiscountEditor } from './_components/billing-editors';

export const dynamic = 'force-dynamic';

/** One clock read, outside render. */
function thisMonth() {
  return currentIstMonth(new Date());
}

function NoAccess({ message }: { message: string }) {
  return (
    <div className="rounded-md border p-6">
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground mt-1 text-sm">{message}</p>
    </div>
  );
}

export default async function AiBillsPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { slug } = await params;
  const { month: asked } = await searchParams;

  const session = await createClient();
  const { data: org } = await session.from('organizations').select('id, name').eq('slug', slug).single();
  if (!org) {
    return <NoAccess message="Your account isn't a member of this organization. Contact the platform admin." />;
  }
  const {
    data: { user }
  } = await session.auth.getUser();
  if (!user) return <NoAccess message="Sign in first." />;

  const now = thisMonth();
  const month = isMonthKey(asked) && asked <= now ? asked : now;
  const admin = createAdminClient();
  const bills = await loadOrgBills(admin, user.id, org.id, month);
  const { scope } = bills;

  if (!scope.orgAdmin && scope.apps.length === 0) {
    return (
      <NoAccess message="You aren't on any app's team in this organization, so there is no AI bill to show you. Ask an organization admin to add you to your app." />
    );
  }

  const appLines = bills.lines.filter((l) => l.billed_to_app);
  const noAppLines = bills.lines.filter((l) => !l.billed_to_app);
  const clientOptions = bills.clients.map((c) => ({ id: c.myjkkn_client_id, name: c.name_cached }));
  const months = recentMonths(now, 12).map((m) => ({ value: m, label: monthLabel(m) }));
  const t = bills.totals;
  const isCurrent = month === now;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Bills</h1>
          <p className="text-muted-foreground max-w-3xl text-sm">
            Each app&apos;s AI bill for the month: what the Claude API would have charged for its
            runs, minus its client&apos;s discount. Failed runs are not billed. Test runs are.
            Months follow India time.{' '}
            {scope.orgAdmin ? 'You see every app.' : 'You see only the apps you work on.'}{' '}
            <Link href={`/org/${slug}/ai/models`} className="underline">
              See the AI tasks
            </Link>
            .
          </p>
        </div>
        <MonthPicker month={month} options={months} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: isCurrent ? `${monthLabel(month)} so far` : monthLabel(month), value: formatUsd(t.billed_usd), sub: formatInr(t.billed_inr) },
          { label: 'API price', value: formatUsd(t.api_usd), sub: formatInr(usdToInr(t.api_usd)) },
          { label: 'Billed runs', value: String(t.billable_runs), sub: `${t.test_runs} test runs among all runs` },
          { label: 'Not billed', value: String(t.failed_runs + t.unpriced_runs), sub: `${t.failed_runs} failed · ${t.unpriced_runs} unpriced` }
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
              <p className="text-muted-foreground mt-1 text-xs">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bills by app — {monthLabel(month)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Billed runs</TableHead>
                <TableHead className="text-right">Test runs</TableHead>
                <TableHead className="text-right">Failed (not billed)</TableHead>
                <TableHead className="text-right">Unpriced runs</TableHead>
                <TableHead className="text-right">API price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Bill (USD)</TableHead>
                <TableHead className="text-right">Bill (INR)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appLines.map((l) => (
                <TableRow key={l.key} className={l.runs === 0 ? 'text-muted-foreground' : undefined}>
                  <TableCell className="font-medium">
                    <Link href={`/org/${slug}/apps/${l.app_slug}/ai`} className="hover:underline">
                      {l.app_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {scope.orgAdmin && bills.clientsReady && l.application_id ? (
                      <AppClientSelect
                        applicationId={l.application_id}
                        appName={l.app_name}
                        clientId={l.client_id}
                        clients={clientOptions}
                      />
                    ) : l.client_name ? (
                      l.client_name
                    ) : (
                      <span className="text-muted-foreground">No client linked</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{l.runs}</TableCell>
                  <TableCell className="text-right">{l.billable_runs}</TableCell>
                  <TableCell className="text-right">{l.test_runs}</TableCell>
                  <TableCell className="text-right">{l.failed_runs}</TableCell>
                  <TableCell className="text-right">{l.unpriced_runs}</TableCell>
                  <TableCell className="text-right">{formatUsd(l.api_usd)}</TableCell>
                  <TableCell className="text-right">{l.discount_pct}%</TableCell>
                  <TableCell className="text-right font-medium">{formatUsd(l.billed_usd)}</TableCell>
                  <TableCell className="text-right">{formatInr(l.billed_inr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Total ({appLines.length} apps)</TableCell>
                <TableCell className="text-right">{t.runs}</TableCell>
                <TableCell className="text-right">{t.billable_runs}</TableCell>
                <TableCell className="text-right">{t.test_runs}</TableCell>
                <TableCell className="text-right">{t.failed_runs}</TableCell>
                <TableCell className="text-right">{t.unpriced_runs}</TableCell>
                <TableCell className="text-right">{formatUsd(t.api_usd)}</TableCell>
                <TableCell />
                <TableCell className="text-right">{formatUsd(t.billed_usd)}</TableCell>
                <TableCell className="text-right">{formatInr(t.billed_inr)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            Unpriced runs succeeded but have no recorded API price (runs before 24 Oct 2026, or
            the worker did not report one); they add nothing to the bill. INR is shown at an
            assumed ₹{USD_TO_INR_ASSUMED} per US dollar, not a live rate.
          </p>
        </CardContent>
      </Card>

      {scope.orgAdmin && noAppLines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runs not tied to an app (not billed)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-3 text-sm">
              These runs carry no app, so no app is billed for them, for example the Control
              Tower&apos;s own checks on each Claude account.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Priced runs</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Unpriced runs</TableHead>
                  <TableHead className="text-right">API price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {noAppLines.map((l) => (
                  <TableRow key={l.key}>
                    <TableCell>
                      <code className="text-xs">{l.app_slug}</code>{' '}
                      <Badge variant="secondary">no app</Badge>
                    </TableCell>
                    <TableCell className="text-right">{l.runs}</TableCell>
                    <TableCell className="text-right">{l.billable_runs}</TableCell>
                    <TableCell className="text-right">{l.failed_runs}</TableCell>
                    <TableCell className="text-right">{l.unpriced_runs}</TableCell>
                    <TableCell className="text-right">{formatUsd(l.api_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {scope.orgAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clients and discounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!bills.clientsReady ? (
              <p className="text-muted-foreground text-sm">
                Linking apps to clients and setting discounts appears here once the
                20261025_ai_billing_clients migration is applied. Until then every app is
                billed at 0% discount.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Clients are kept in MyJKKN. Here you only add a client&apos;s MyJKKN id (with
                  its name to show) and set its discount. A new client starts at 0%.
                </p>
                {bills.clients.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No clients added yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>MyJKKN id</TableHead>
                        <TableHead>Discount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bills.clients.map((c) => (
                        <TableRow key={c.myjkkn_client_id}>
                          <TableCell className="font-medium">{c.name_cached}</TableCell>
                          <TableCell className="font-mono text-xs">{c.myjkkn_client_id}</TableCell>
                          <TableCell>
                            <ClientDiscountEditor
                              clientId={c.myjkkn_client_id}
                              name={c.name_cached}
                              discount={Number(c.discount_pct)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <AddClientForm organizationId={org.id} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
