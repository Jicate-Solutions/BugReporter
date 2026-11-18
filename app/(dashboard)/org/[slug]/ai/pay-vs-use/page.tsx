/**
 * Claude accounts: what we pay vs what we use (Director, 18 Nov 2026).
 *
 * Platform admins only. A signed-in user who is not one sees a plain "no
 * access" panel (never a redirect), and nothing is read for them.
 *
 * All maths lives in lib/ai-engine/pay-vs-use.ts (tested). This page only lays
 * it out, phone first: one card per account, no wide tables.
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ago, isSuperAdmin } from '@/lib/ai-engine/admin';
import {
  INR_PER_USD_ASSUMED,
  MONTHLY_FEE_INR,
  PAID_ACCOUNTS,
  feeSoFar,
  readPayVsUse,
  usdToInr,
  type PayVsUseRow
} from '@/lib/ai-engine/pay-vs-use';
import { IdleLineEditor } from './_components/idle-line-editor';

export const dynamic = 'force-dynamic';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-IN')}`;

const BOX_NAMES: Record<string, string> = {
  Biometric: 'Box 1 (Biometric)',
  'DESKTOP-1LB1FCS': 'Box 2 (DESKTOP-1LB1FCS)'
};

function NoAccess({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="rounded-md border p-6">
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {signedIn
          ? 'Only platform admins can see what the Claude accounts cost and how much they are used. Contact the platform admin if you need it.'
          : 'Sign in first. Only platform admins can see this page.'}
      </p>
    </div>
  );
}

function fmtDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function AverageLine({ row, historyReady }: { row: PayVsUseRow; historyReady: boolean }) {
  const a = row.avg;
  if (a.kind === 'avg') {
    return (
      <p className="text-sm">
        Average weekly use: <span className="font-semibold">{a.pct}%</span>
        <span className="text-muted-foreground">
          {' '}
          (highest reading in each of the last {a.weeks} full week{a.weeks === 1 ? '' : 's'}: {a.peaksPct.join('%, ')}%)
        </span>
      </p>
    );
  }
  if (a.kind === 'short') {
    return (
      <p className="text-sm">
        Average weekly use: <span className="text-muted-foreground">not yet. History starts {fmtDay(a.firstDay)} ({a.days} day
        {a.days === 1 ? '' : 's'} so far); an average needs one full week.</span>
      </p>
    );
  }
  return (
    <p className="text-sm">
      Average weekly use:{' '}
      <span className="text-muted-foreground">
        {!row.connected
          ? 'no history. The Control Tower has never read this account.'
          : historyReady
            ? "no history yet. It starts with this account's next reading."
            : 'no history yet. The daily record starts the day its table is switched on (waiting for approval).'}
      </span>
    </p>
  );
}

function IdleBadge({ row, line }: { row: PayVsUseRow; line: number }) {
  if (row.idle === 'idle')
    return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Idle (under {line}%)</Badge>;
  if (row.idle === 'in-use')
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">In use</Badge>;
  return <Badge variant="secondary">Not known yet</Badge>;
}

/** One clock read per request, outside render, for every number on the page. */
async function load(admin: ReturnType<typeof createAdminClient>) {
  const now = Date.now();
  return { now, d: await readPayVsUse(admin, now) };
}

export default async function PayVsUsePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await createClient();
  const {
    data: { user }
  } = await session.auth.getUser();
  if (!user) return <NoAccess signedIn={false} />;
  const admin = createAdminClient();
  if (!(await isSuperAdmin(admin, user.id))) return <NoAccess signedIn />;

  const { now, d } = await load(admin);
  const fullFee = MONTHLY_FEE_INR * PAID_ACCOUNTS.length;
  const feeToDate = feeSoFar(fullFee, d.month.dayOfMonth, d.month.daysInMonth);
  const idle = d.rows.filter((r) => r.idle === 'idle').length;
  const unknown = d.rows.filter((r) => r.idle === 'unknown').length;
  const neverRead = d.rows.filter((r) => !r.connected).map((r) => r.label);
  const box1 = d.boxes.find((b) => b.host === 'Biometric');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Claude accounts: what we pay vs what we use</h1>
        <p className="text-muted-foreground text-sm">
          {d.month.label}, day {d.month.dayOfMonth} of {d.month.daysInMonth} (India time). {PAID_ACCOUNTS.length} paid Max
          accounts at {rs(MONTHLY_FEE_INR)} a month each.{' '}
          <Link href={`/org/${slug}/ai/routines`} className="underline">
            Account settings
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: 'We pay a month', value: rs(fullFee), note: `${rs(feeToDate)} of it so far this month` },
          {
            label: 'API price of Tower jobs this month',
            value: rs(usdToInr(d.ledgerTotal.usd)),
            note: `${usd(d.ledgerTotal.usd)} over ${d.ledgerTotal.jobs.toLocaleString('en-IN')} jobs. Box 1 is not in this (see below).`
          },
          { label: 'Idle accounts', value: String(idle), note: `average weekly use under ${d.idleBelowPct}%` },
          { label: 'Not known yet', value: String(unknown), note: 'no full week of history' }
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
              <p className="text-muted-foreground mt-1 text-xs">{c.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-amber-300 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="text-base">What is NOT counted yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium">MyJKKN jobs on Box 1 are left out of every account below.</p>
            {box1 ? (
              <p>
                Box 1 reports {usd(box1.usd)} API price over the last {box1.days} days, across{' '}
                {box1.jobs.toLocaleString('en-IN')} jobs (about {rs(usdToInr(box1.usd))} a week; at that rate about{' '}
                {rs((usdToInr(box1.usd) * d.month.daysInMonth) / box1.days)} a month, an estimate).
                {box1.reportAt ? ` Reported ${ago(box1.reportAt, now)}.` : ''}
              </p>
            ) : d.boxesError ? (
              <p className="text-red-700 dark:text-red-400">Could not read the box reports just now. Reload in a minute.</p>
            ) : (
              <p>Box 1 has not sent a 7-day price yet.</p>
            )}
            <p className="text-muted-foreground">
              Where it is recorded: Box 1 adds that figure up itself, from its own log files (the MyJKKN max-lane
              cost.log, plus the logs of JICATE workers 3 and 4), and sends only the total. It never reaches the
              Control Tower&apos;s job ledger, and it does not say which Claude account ran each job. MyJKKN&apos;s own
              database logs the same jobs (its ai_jobs table, &quot;max&quot; lanes, and its ai_model_usage table as
              &quot;claude_code&quot;), but every row there is priced Rs 0 and has no account name. Checked 18 Nov 2026:
              about 14,700 max-lane jobs in 7 days there; JICATE workers 3 and 4 added under $0.10 of that week&apos;s
              Tower price, so nearly all of Box 1&apos;s figure is MyJKKN.
            </p>
          </div>
          {d.boxes
            .filter((b) => b.host !== 'Biometric')
            .map((b) => (
              <p key={b.host}>
                {BOX_NAMES[b.host] ?? b.host} reports {usd(b.usd)} over {b.days} days across{' '}
                {b.jobs.toLocaleString('en-IN')} jobs, from its own logs. Its jobs are mostly also in the Tower ledger
                below, so do not add the two.
              </p>
            ))}
          {neverRead.length > 0 && (
            <p>
              {neverRead.length} of the {PAID_ACCOUNTS.length} accounts ({neverRead.join(', ')}) have never been read by
              the Control Tower: no key stored here, no reading, no jobs. Their use only shows on the Mac or on
              claude.ai.
            </p>
          )}
          <p>
            Claude tabs on the Mac (the desks) use these same accounts. Their use is inside each account&apos;s weekly
            reading, but not in the job counts or the API price.
          </p>
          {d.unassigned.jobs > 0 && (
            <p>
              {d.unassigned.jobs.toLocaleString('en-IN')} Tower jobs this month have no account recorded (
              {usd(d.unassigned.usd)}).
            </p>
          )}
          {d.otherAccounts.map((o) => (
            <p key={o.label}>
              {o.use.jobs.toLocaleString('en-IN')} Tower jobs this month ran on &quot;{o.label}&quot;
              {o.label === 'default' ? " (each box's own sign-in)" : ''}, which is not in the paid list ({usd(o.use.usd)}).
            </p>
          ))}
          {d.ledgerCapped && (
            <p className="text-red-700 dark:text-red-400">
              The Tower ledger had more rows this month than this page reads; the job counts are too low.
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            API price = what the same work would cost at Anthropic&apos;s list price, as the Claude tool reports it. Rupees
            use Rs {INR_PER_USD_ASSUMED} to the dollar (assumed, not a live rate).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <IdleLineEditor value={d.idleBelowPct} />
          <p className="text-muted-foreground mt-2 text-xs">
            Average weekly use = the highest weekly reading in each of the last 4 full weeks, averaged. (The weekly reading
            falls to 0 each time it renews, so a plain average would show about half the real use.) No full week yet means
            &quot;not known&quot;, never idle.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {d.rows.map((r) => {
          const work = r.use.jobs - r.use.checkJobs;
          return (
            <Card key={r.label}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{r.label}</CardTitle>
                  <IdleBadge row={r} line={d.idleBelowPct} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {rs(r.feeInr)} a month · {rs(feeSoFar(r.feeInr, d.month.dayOfMonth, d.month.daysInMonth))} so far this
                  month
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                <AverageLine row={r} historyReady={d.historyReady} />
                <p className="text-muted-foreground text-xs">
                  {!r.connected
                    ? 'Latest reading: none. Not connected to the Control Tower.'
                    : r.latestWeekPct == null
                      ? `Latest reading: none for this week yet${r.latestAt ? ` (last read ${ago(r.latestAt, now)})` : ''}.`
                      : `Latest reading: ${r.latestWeekPct}% of this week used, read ${ago(r.latestAt, now)}.`}
                </p>
                <p className="text-sm">
                  Tower jobs this month: <span className="font-semibold">{r.use.jobs.toLocaleString('en-IN')}</span>
                  {r.use.checkJobs > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({r.use.checkJobs.toLocaleString('en-IN')} account checks, {work.toLocaleString('en-IN')} real work)
                    </span>
                  )}
                </p>
                {r.use.apps.length > 0 && (
                  <ul className="text-muted-foreground space-y-0.5 text-xs">
                    {r.use.apps.map((a) => (
                      <li key={a.app}>
                        {a.app}: {a.jobs.toLocaleString('en-IN')} job{a.jobs === 1 ? '' : 's'} · {usd(a.usd)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-sm">
                  API price this month: <span className="font-semibold">{rs(usdToInr(r.use.usd))}</span>
                  <span className="text-muted-foreground"> ({usd(r.use.usd)}) against {rs(r.feeInr)} we pay</span>
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
