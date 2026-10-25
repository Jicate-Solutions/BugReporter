/**
 * Month-to-date AI bill for one app, on that app's AI tab.
 *
 * Server component. Shown to the app's own team and to org owners / admins
 * (lib/ai-engine/bills-data.ts decides); anyone else sees a short "not on this
 * app's team" note instead of numbers.
 */

import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { USD_TO_INR_ASSUMED, apiPriceLabel, formatInr, formatUsd, monthLabel } from '@/lib/ai-engine/billing';
import { loadAppMonthToDate } from '@/lib/ai-engine/bills-data';

/** One clock read, outside render. */
function clock() {
  return new Date();
}

export async function AppBillCard({
  slug,
  organizationId,
  applicationId
}: {
  slug: string;
  organizationId: string;
  applicationId: string;
}) {
  const session = await createClient();
  const {
    data: { user }
  } = await session.auth.getUser();
  const bill = user
    ? await loadAppMonthToDate(createAdminClient(), user.id, organizationId, applicationId, clock())
    : ({ visible: false } as const);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          AI bill {bill.visible ? `— ${monthLabel(bill.month)} so far` : ''}
        </CardTitle>
        {bill.visible && (
          <Link href={`/org/${slug}/ai/bills?month=${bill.month}`} className="text-sm underline">
            All months
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {!bill.visible ? (
          <p className="text-muted-foreground text-sm">
            Only this app&apos;s team and organization admins can see its AI bill. Ask an
            organization admin to add you to the app&apos;s team.
          </p>
        ) : (
          (() => {
            const l = bill.line;
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-3xl font-bold">{formatUsd(l?.billed_usd ?? 0)}</span>
                  <span className="text-muted-foreground">{formatInr(l?.billed_inr ?? 0)}</span>
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>API price {l ? apiPriceLabel(l) : formatUsd(0)}</span>
                  <span>
                    {l?.client_name ? `${l.client_name} · ${l.discount_pct}% discount` : 'No client linked · 0% discount'}
                  </span>
                  <span>
                    {l?.billable_runs ?? 0} billed runs ({l?.test_runs ?? 0} test) · {l?.failed_runs ?? 0} failed, not billed ·{' '}
                    {l?.unpriced_runs ?? 0} unpriced
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Bill = Claude API price of this app&apos;s successful runs this month (India
                  time), minus its client&apos;s discount. INR at an assumed ₹{USD_TO_INR_ASSUMED}{' '}
                  per US dollar.
                </p>
              </div>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}
