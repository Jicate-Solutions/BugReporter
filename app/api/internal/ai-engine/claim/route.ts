/**
 * POST /api/internal/ai-engine/claim — a JICATE AI engine runner takes ONE job.
 *
 * Auth: `Authorization: Bearer <runner token>` only (lib/ai-engine/runner-auth.ts).
 * The runner name (claimed_by, heartbeat) comes from the token's row, not the body.
 *
 * 200 { job: null }                                     nothing to do
 * 200 { job: { job_id, job_type, attempts, model,
 *              output_format, timeout_ms, prompt } }    run this prompt
 * Both carry account: { use, fallback } — which Claude account label this
 * worker should run on (null = the box's own sign-in) and whether to fall back.
 *
 * Body (optional): { accounts: ["acct2", ...], host } — the account labels the
 * worker holds (names only; keys never leave the box) and its computer name.
 * Stored for the AI Routines page.
 *
 * account 'auto': the Tower picks, among the worker's labels plus "default",
 * the highest-priority account that still has allowance (both windows under
 * 95%, or already renewed); equal priority goes to the lowest weekly usage. So
 * workers drain accounts in priority order and switch back when one renews.
 * If none has allowance, the one that renews first.
 *
 * The runner gets a finished prompt; the recipe lives in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkEngineRunnerAuth } from '@/lib/ai-engine/runner-auth';
import { claimEngineJob } from '@/lib/ai-engine/engine';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    accounts: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/)).max(20).optional(),
    host: z.string().max(100).optional()
  })
  .catch({});

type AccountReading = {
  label: string;
  priority: number | null;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
};

const FULL = 0.95;

/** Priority order, skipping accounts out of allowance until they renew. */
async function pickAuto(admin: ReturnType<typeof createAdminClient>, labels: string[]) {
  const { data } = await admin
    .from('ai_accounts')
    .select('label, priority, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at')
    .in('label', labels);
  const byLabel = new Map(((data ?? []) as AccountReading[]).map((r) => [r.label, r]));
  const now = Date.now();
  // A reading taken before its window renewed no longer counts.
  const used = (util: number | null, resets: string | null) =>
    util == null || (resets && new Date(resets).getTime() <= now) ? 0 : Number(util);
  const info = labels.map((l) => {
    const r = byLabel.get(l);
    const five = used(r?.five_hour_util ?? null, r?.five_hour_resets_at ?? null);
    const week = used(r?.seven_day_util ?? null, r?.seven_day_resets_at ?? null);
    const renews = Math.min(
      ...[r?.five_hour_resets_at, r?.seven_day_resets_at]
        .filter((t): t is string => Boolean(t))
        .map((t) => new Date(t).getTime())
        .filter((t) => t > now),
      Number.MAX_SAFE_INTEGER
    );
    return { l, prio: r?.priority ?? 100, five, week, ok: five < FULL && week < FULL, renews };
  });
  const usable = info.filter((a) => a.ok).sort((a, b) => a.prio - b.prio || a.week - b.week || a.five - b.five);
  if (usable.length) return usable[0].l;
  return info.sort((a, b) => a.renews - b.renews)[0].l;
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const auth = await checkEngineRunnerAuth(request, admin);
  if (!auth.ok) return auth.response;

  const body = bodySchema.parse(await request.json().catch(() => ({})));

  try {
    const job = await claimEngineJob(admin, auth.runner);
    // After the claim, which has upserted this runner's heartbeat row.
    const [{ data: r }, { data: sec }] = await Promise.all([
      admin
        .from('ai_runners')
        .select('account, account_fallback, accounts_available, host')
        .eq('name', auth.runner)
        .maybeSingle(),
      // Accounts whose key is kept in the Control Tower are available to every
      // worker; the worker fetches the key itself (/api/internal/ai-engine/account-key).
      admin.from('ai_account_secrets').select('label')
    ]);
    const row = r as {
      account: string | null;
      account_fallback: boolean;
      accounts_available: string[] | null;
      host: string | null;
    } | null;
    const central = ((sec ?? []) as { label: string }[]).map((x) => x.label);
    const local = body.accounts ?? (row?.accounts_available ?? []).filter((l) => !central.includes(l));
    const held = [...new Set([...local, ...central])].sort();
    const before = [...(row?.accounts_available ?? [])].sort();
    // Write only when something changed: this runs on every poll.
    if (held.join() !== before.join() || (body.host && body.host !== row?.host)) {
      await admin
        .from('ai_runners')
        .update({ accounts_available: held, ...(body.host ? { host: body.host } : {}) })
        .eq('name', auth.runner);
    }
    let use = row?.account ?? null;

    // Make sure every label this worker holds (and "default") has a row, so it
    // can be given a priority on the AI Routines page before its first reading.
    if (body.accounts && held.join() !== before.join()) {
      await admin
        .from('ai_accounts')
        .upsert(
          ['default', ...body.accounts].map((label) => ({ label })),
          { onConflict: 'label', ignoreDuplicates: true }
        );
    }
    if (use === 'auto') {
      const labels = ['default', ...held.filter((l) => l !== 'default')];
      const best = await pickAuto(admin, labels);
      use = best === 'default' ? null : best;
    }
    const account = { use, fallback: row?.account_fallback ?? true, central };
    return NextResponse.json({ job, account }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[ai-engine/claim] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: 'CLAIM_FAILED', message: 'Could not claim a job.' } },
      { status: 500 }
    );
  }
}
