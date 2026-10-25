/**
 * AI Usage — runs, API price, actual cost, billed and saving, sliced by
 * client, app, model, task or Claude account over a date range (Director,
 * 24 Oct 2026).
 *
 * Org owners / admins and platform admins see everything; app teams see only
 * their own apps (lib/ai-engine/usage-data.ts). Arithmetic and the cost
 * allocation method: lib/ai-engine/usage-report.ts. "Billed" is the monthly
 * bill function from lib/ai-engine/billing.ts.
 *
 * Server component; the filters are a plain GET form, so the page works
 * without client JavaScript.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { USD_TO_INR_ASSUMED, formatInr, formatUsd, monthLabel } from '@/lib/ai-engine/billing';
import {
  DIMENSION_LABEL,
  MAX_ACCOUNT_INR_PER_MONTH,
  USAGE_DIMENSIONS,
  daysInclusive,
  isDayKey,
  istDayOf,
  type UsageDimension,
  type UsageSlice
} from '@/lib/ai-engine/usage-report';
import { loadUsageReport } from '@/lib/ai-engine/usage-data';

export const dynamic = 'force-dynamic';

const MAX_DAYS = 366;

/** One clock read, outside render. */
function today() {
  return istDayOf(new Date());
}

function NoAccess({ message }: { message: string }) {
  return (
    <div className="rounded-md border p-6">
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground mt-1 text-sm">{message}</p>
    </div>
  );
}

function apiCell(s: UsageSlice) {
  return s.priced_runs === 0 && s.unpriced_runs > 0 ? 'not priced' : formatInr(s.api_inr);
}

function SliceCells({ s }: { s: UsageSlice }) {
  return (
    <>
      <TableCell className="text-right">
        {s.runs}
        {(s.unpriced_runs > 0 || s.failed_runs > 0) && (
          <div className="text-muted-foreground text-xs">
            {s.unpriced_runs > 0 && `${s.unpriced_runs} unpriced`}
            {s.unpriced_runs > 0 && s.failed_runs > 0 && ' · '}
            {s.failed_runs > 0 && `${s.failed_runs} failed`}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {apiCell(s)}
        {s.priced_runs > 0 && <div className="text-muted-foreground text-xs">{formatUsd(s.api_usd)}</div>}
      </TableCell>
      <TableCell className="text-right">{formatInr(s.actual_inr)}</TableCell>
      <TableCell className="text-right">
        {formatInr(s.billed_inr)}
        <div className="text-muted-foreground text-xs">{formatUsd(s.billed_usd)}</div>
      </TableCell>
      <TableCell className={s.saving_inr < 0 ? 'text-right text-red-700 dark:text-red-400' : 'text-right'}>
        {formatInr(s.saving_inr)}
      </TableCell>
    </>
  );
}

export default async function AiUsagePage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; by?: string }>;
}) {
  const { slug } = await params;
  const q = await searchParams;

  const session = await createClient();
  const { data: org } = await session.from('organizations').select('id, name').eq('slug', slug).single();
  if (!org) {
    return <NoAccess message="Your account isn't a member of this organization. Contact the platform admin." />;
  }
  const {
    data: { user }
  } = await session.auth.getUser();
  if (!user) return <NoAccess message="Sign in first." />;

  // ── filters (bad input → defaults, with a note) ──
  const now = today();
  const monthStart = `${now.slice(0, 7)}-01`;
  let from = isDayKey(q.from) ? q.from : monthStart;
  let to = isDayKey(q.to) ? q.to : now;
  let filterNote: string | null = null;
  if (to > now) {
    to = now;
    filterNote = 'The end date was in the future, so it is set to today.';
  }
  if (from > to || daysInclusive(from, to) > MAX_DAYS) {
    filterNote = `Pick a start date on or before the end date, at most ${MAX_DAYS} days apart. Showing this month instead.`;
    from = monthStart;
    to = now;
  }
  const dimension: UsageDimension = (USAGE_DIMENSIONS as readonly string[]).includes(q.by ?? '')
    ? (q.by as UsageDimension)
    : 'app';

  const admin = createAdminClient();
  const report = await loadUsageReport(admin, user.id, org.id, { from, to, dimension });
  const { scope } = report;
  if (!scope.orgAdmin && scope.apps.length === 0) {
    return (
      <NoAccess message="You aren't on any app's team in this organization, so there is no AI usage to show you. Ask an organization admin to add you to your app." />
    );
  }
  const t = report.total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Usage</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          What the AI runs would have cost on the Claude API, what they actually cost us on
          the Max plan, what the apps are billed, and the saving.{' '}
          {scope.orgAdmin ? 'You see every app.' : 'You see only the apps you work on.'}{' '}
          <Link href={`/org/${slug}/ai/bills`} className="underline">
            See the monthly bills
          </Link>
          .
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="usage-from">From</Label>
          <Input id="usage-from" type="date" name="from" defaultValue={from} max={now} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-to">To</Label>
          <Input id="usage-to" type="date" name="to" defaultValue={to} max={now} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-by">Group by</Label>
          <select
            id="usage-by"
            name="by"
            defaultValue={dimension}
            className="border-input bg-background h-9 w-44 rounded-md border px-3 text-sm"
          >
            {USAGE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {DIMENSION_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Show</Button>
        <p className="text-muted-foreground w-full text-xs">Dates are India time, both days included.</p>
      </form>

      {filterNote && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {filterNote}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: 'API price', value: apiCell(t), sub: `${t.runs} runs · ${formatUsd(t.api_usd)}` },
          { label: 'Actual cost', value: formatInr(t.actual_inr), sub: 'share of the Max accounts' },
          { label: 'Billed', value: formatInr(t.billed_inr), sub: formatUsd(t.billed_usd) },
          { label: 'Saving', value: formatInr(t.saving_inr), sub: 'API price − actual cost' }
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
          <CardTitle className="text-base">
            By {DIMENSION_LABEL[dimension].toLowerCase()} · {from} to {to}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.slices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No AI runs in these dates.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{DIMENSION_LABEL[dimension]}</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">API price</TableHead>
                  <TableHead className="text-right">Actual cost</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Saving</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.slices.map((s) => (
                  <TableRow key={s.key}>
                    <TableCell className={dimension === 'model' || dimension === 'task' ? 'font-mono text-xs' : 'font-medium'}>
                      {s.label}
                    </TableCell>
                    <SliceCells s={s} />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <SliceCells s={t} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
          {!report.clientsReady && dimension === 'client' && (
            <p className="text-muted-foreground mt-3 text-xs">
              No app is linked to a client yet (the 20261025_ai_billing_clients migration is not
              applied), so every app shows as &quot;No client linked&quot;.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How these numbers are worked out</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            <span className="text-foreground font-medium">API price</span>: what the Claude API
            would have charged for the successful runs (recorded per run since 24 Oct 2026).
            Runs with no recorded price are counted as unpriced, not as zero.
          </p>
          <p>
            <span className="text-foreground font-medium">Actual cost</span>: each Claude Max
            account costs {formatInr(MAX_ACCOUNT_INR_PER_MONTH)} a month. That amount is shared
            among the account&apos;s successful, priced runs in the same calendar month (India
            time), in proportion to each run&apos;s API price, across all apps, whatever dates or
            group you pick. Failed runs, unpriced runs and runs with no recorded account get no
            share. An account with no priced runs in a month leaves its cost unallocated. In the
            current month the cost is shared among the runs so far, so these figures change
            until the month ends.
          </p>
          <p>
            <span className="text-foreground font-medium">Billed</span>: the monthly bill rule,
            API price minus the app&apos;s client discount. Test runs are billed. Failed runs and
            runs with no app are not.
          </p>
          <p>
            <span className="text-foreground font-medium">Saving</span>: API price (in rupees)
            minus actual cost. It is negative when the Max accounts cost more than the API would
            have.
          </p>
          <p>Rupees use an assumed rate of ₹{USD_TO_INR_ASSUMED} per US dollar, not a live rate.</p>
        </CardContent>
      </Card>

      {report.accounts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Claude accounts by month</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">API price of its runs</TableHead>
                  <TableHead className="text-right">Monthly cost</TableHead>
                  <TableHead className="text-right">Unallocated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.accounts.map((a) => (
                  <TableRow key={`${a.month}|${a.account}`}>
                    <TableCell>{monthLabel(a.month)}</TableCell>
                    <TableCell className="font-mono text-xs">{a.account}</TableCell>
                    <TableCell className="text-right">{formatUsd(a.api_usd)}</TableCell>
                    <TableCell className="text-right">{formatInr(a.cost_inr)}</TableCell>
                    <TableCell className={a.unallocated_inr > 0 ? 'text-right text-amber-700 dark:text-amber-400' : 'text-right'}>
                      {formatInr(a.unallocated_inr)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-muted-foreground mt-3 text-xs">
              Whole months, whatever dates are picked above. Each account listed is counted as one
              Max plan at {formatInr(MAX_ACCOUNT_INR_PER_MONTH)} a month; &quot;default&quot; is a
              box&apos;s own sign-in.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
