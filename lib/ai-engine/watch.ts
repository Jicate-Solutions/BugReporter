/**
 * AI engine watch — emails to the Director (decisions 2026-10-19):
 *
 *   1. Workers down: no JICATE worker has checked in for 15 minutes → one email.
 *      One more when a worker is back. Never repeated while the state holds.
 *   2. Safety alerts: open alerts raised since the last email → one email, at
 *      most once an hour; alerts raised in between are counted in the next one.
 *      The email carries counts and a link only, never the learner's words.
 *   3. Reminder: while any alert has stayed open for over a day, one reminder
 *      each morning (from 9 am India time) until all are followed up.
 *   4. Failing jobs: 3 or more jobs ended in error in the last 30 minutes →
 *      one email, at most every 2 hours.
 *   5. Account nearly used up: a Claude account passes 90% of its 5-hour or
 *      weekly allowance → one email for that account; it re-arms once the
 *      reading drops back below 90% (after the reset).
 *   6. One box dark (decision 2026-10-23): a Windows box whose workers and box
 *      agent have all been silent for 10 minutes → one email naming that box,
 *      one more when it is back. Rule 1 only fires when EVERY worker is down,
 *      so a single box stuck at its login screen went unnoticed.
 *
 * Recipient: AI_ALERT_EMAIL (comma-separated allowed). Unset → nothing is sent
 * and the run says so. State lives in ai_engine_watch. Called by the cron route.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { enqueueAccountProbes, PROBE_JOB_TYPE } from '@/lib/ai-engine/accounts';

const DOWN_AFTER_MS = 15 * 60_000;
const SAFETY_EMAIL_GAP_MS = 60 * 60_000;
const REMINDER_AFTER_MS = 24 * 60 * 60_000;
const REMINDER_HOUR_IST = 9;
const FAILURE_WINDOW_MS = 30 * 60_000;
const FAILURE_THRESHOLD = 3;
const FAILURE_EMAIL_GAP_MS = 2 * 60 * 60_000;
export const BOX_DARK_AFTER_MS = 10 * 60_000;

/** Mailbox names for the boxes, so an email says which computer it means. */
const BOX_NAMES: Record<string, string> = {
  Biometric: 'win-first, the first box',
  'DESKTOP-1LB1FCS': 'win-ai, the second box'
};

export interface WatchSummary {
  recipients: number;
  workers: 'up' | 'down' | 'none-registered';
  sent: string[];
  /** Accounts a check job was queued for this run. */
  probes: string[];
}

interface WatchState {
  workers_down?: boolean;
  last_safety_email_at?: string;
  /** India date (YYYY-MM-DD) of the last open-alert reminder. */
  last_reminder_date?: string;
  last_failure_email_at?: string;
  /** Hosts a "box is dark" email went out for and no "back" email yet. */
  dark_boxes?: string[];
}

/**
 * Hosts whose every signal is older than BOX_DARK_AFTER_MS: each worker's
 * check-in and, when the box has one, its box agent's check-in. A host with
 * any fresh signal is alive.
 */
export function darkHosts(
  runners: { host: string | null; last_seen_at: string | null }[],
  boxes: { host: string; agent_seen_at: string | null }[],
  now: number
): string[] {
  const newest = new Map<string, number>();
  const see = (host: string | null, at: string | null) => {
    if (!host) return;
    const t = at ? new Date(at).getTime() : 0;
    newest.set(host, Math.max(newest.get(host) ?? 0, Number.isFinite(t) ? t : 0));
  };
  for (const r of runners) see(r.host, r.last_seen_at);
  for (const b of boxes) see(b.host, b.agent_seen_at);
  return [...newest.entries()]
    .filter(([, t]) => now - t >= BOX_DARK_AFTER_MS)
    .map(([h]) => h)
    .sort();
}

/** India date and hour for a moment, without depending on the server's zone. */
function indiaClock(ms: number): { date: string; hour: number } {
  const ist = new Date(ms + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

async function readState(admin: SupabaseClient): Promise<WatchState> {
  const { data } = await admin.from('ai_engine_watch').select('value').eq('key', 'state').maybeSingle();
  return ((data as { value: WatchState } | null)?.value ?? {}) as WatchState;
}

async function writeState(admin: SupabaseClient, state: WatchState): Promise<void> {
  const { error } = await admin
    .from('ai_engine_watch')
    .upsert({ key: 'state', value: state, updated_at: new Date().toISOString() });
  if (error) throw new Error(`watch state write failed: ${error.message}`);
}

async function send(to: string[], subject: string, lines: string[], link: string): Promise<boolean> {
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
${lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('\n')}
<p style="margin:16px 0"><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the Control Tower</a></p>
<p style="margin:0;color:#666;font-size:13px">JICATE Control Tower · AI engine watch</p></div>`;
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.NOTIFICATION_FROM_EMAIL || 'noreply@bugreporter.dev',
      to,
      subject,
      html
    });
    if (error) {
      console.error('[ai-engine-watch] email failed:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ai-engine-watch] email failed:', err);
    return false;
  }
}

/** The org slug used in links: the org of the newest alert, else Plug the Leak's org. */
async function linkSlug(admin: SupabaseClient, organizationId: string | null): Promise<string | null> {
  let orgId = organizationId;
  if (!orgId) {
    const { data } = await admin.from('applications').select('organization_id').eq('slug', 'plug-the-leak').maybeSingle();
    orgId = (data as { organization_id: string } | null)?.organization_id ?? null;
  }
  if (!orgId) return null;
  const { data } = await admin.from('organizations').select('slug').eq('id', orgId).maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}

export async function runEngineWatch(admin: SupabaseClient, origin: string): Promise<WatchSummary> {
  const to = (process.env.AI_ALERT_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const state = await readState(admin);
  const next: WatchState = { ...state };
  const sent: string[] = [];
  const now = Date.now();

  // 1. Workers
  const { data: runners } = await admin.from('ai_runners').select('name, last_seen_at');
  const rows = (runners ?? []) as { name: string; last_seen_at: string }[];
  const anyRecent = rows.some((r) => now - new Date(r.last_seen_at).getTime() < DOWN_AFTER_MS);
  const workers: WatchSummary['workers'] = rows.length === 0 ? 'none-registered' : anyRecent ? 'up' : 'down';
  const slugForWorkers = await linkSlug(admin, null);
  const routinesLink = slugForWorkers ? `${origin}/org/${slugForWorkers}/ai/routines` : origin;

  if (workers === 'down' && !state.workers_down && to.length) {
    const last = rows.map((r) => r.last_seen_at).sort().pop();
    const ok = await send(
      to,
      'JICATE AI workers are offline',
      [
        'No JICATE AI worker has checked in for 15 minutes. Until the Windows box is back, students asking the Plug the Leak coach are told it is resting, and other AI jobs wait.',
        last ? `Last check-in: ${new Date(last).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : '',
        'Check that the Windows box is switched on and online. You will get one more email when it is back.'
      ].filter(Boolean),
      routinesLink
    );
    if (ok) {
      next.workers_down = true;
      sent.push('workers-down');
    }
  } else if (workers === 'up' && state.workers_down && to.length) {
    const ok = await send(
      to,
      'JICATE AI workers are back',
      ['The JICATE AI workers are checking in again. Waiting jobs are being answered.'],
      routinesLink
    );
    if (ok) {
      next.workers_down = false;
      sent.push('workers-back');
    }
  }

  // 2. Safety alerts: at most one email an hour, only for alerts newer than the last email.
  const lastAt = state.last_safety_email_at ? new Date(state.last_safety_email_at).getTime() : 0;
  if (to.length && now - lastAt >= SAFETY_EMAIL_GAP_MS) {
    const { data: fresh } = await admin
      .from('ai_safety_alerts')
      .select('id, organization_id, created_at')
      .is('followed_up_at', null)
      .gt('created_at', new Date(lastAt).toISOString())
      .order('created_at', { ascending: false });
    const alerts = (fresh ?? []) as { id: string; organization_id: string | null; created_at: string }[];
    if (alerts.length) {
      const { count: openTotal } = await admin
        .from('ai_safety_alerts')
        .select('id', { count: 'exact', head: true })
        .is('followed_up_at', null);
      const slug = await linkSlug(admin, alerts[0].organization_id);
      const ok = await send(
        to,
        alerts.length === 1 ? 'A safety alert is waiting' : `${alerts.length} safety alerts are waiting`,
        [
          alerts.length === 1
            ? 'A learner wrote something worrying to an AI coach. The coach replied kindly and told them to talk to a trusted adult.'
            : `${alerts.length} worrying messages came in to an AI coach. The coach replied kindly to each and told them to talk to a trusted adult.`,
          `Open alerts in total: ${openTotal ?? alerts.length}. Read them in the Control Tower and mark each one followed up.`
        ],
        slug ? `${origin}/org/${slug}/ai/safety` : origin
      );
      if (ok) {
        next.last_safety_email_at = new Date(now).toISOString();
        sent.push(`safety:${alerts.length}`);
      }
    }
  }

  // 3. Daily reminder for alerts still open after a day.
  const clock = indiaClock(now);
  if (to.length && clock.hour >= REMINDER_HOUR_IST && state.last_reminder_date !== clock.date) {
    const { data: stale } = await admin
      .from('ai_safety_alerts')
      .select('id, organization_id, created_at')
      .is('followed_up_at', null)
      .lt('created_at', new Date(now - REMINDER_AFTER_MS).toISOString())
      .order('created_at', { ascending: true });
    const old = (stale ?? []) as { id: string; organization_id: string | null; created_at: string }[];
    if (old.length) {
      const slug = await linkSlug(admin, old[0].organization_id);
      const ok = await send(
        to,
        old.length === 1
          ? 'Reminder: a safety alert is still open'
          : `Reminder: ${old.length} safety alerts are still open`,
        [
          `${old.length === 1 ? 'One safety alert has' : `${old.length} safety alerts have`} been waiting for more than a day without being marked followed up.`,
          'Read them in the Control Tower, pass each one to the right person, then mark it followed up. This reminder comes once a morning until they are all done.'
        ],
        slug ? `${origin}/org/${slug}/ai/safety` : origin
      );
      if (ok) {
        next.last_reminder_date = clock.date;
        sent.push(`reminder:${old.length}`);
      }
    }
  }

  // 4. Jobs keep failing.
  const lastFail = state.last_failure_email_at ? new Date(state.last_failure_email_at).getTime() : 0;
  if (to.length && now - lastFail >= FAILURE_EMAIL_GAP_MS) {
    const { data: failed } = await admin
      .from('ai_jobs')
      .select('job_type, error')
      .eq('status', 'error')
      .neq('job_type', PROBE_JOB_TYPE)
      .gt('completed_at', new Date(now - FAILURE_WINDOW_MS).toISOString())
      .limit(50);
    const rows = (failed ?? []) as { job_type: string; error: string | null }[];
    if (rows.length >= FAILURE_THRESHOLD) {
      const byType = new Map<string, number>();
      for (const r of rows) byType.set(r.job_type, (byType.get(r.job_type) ?? 0) + 1);
      const sample = (rows.find((r) => r.error)?.error ?? '').slice(0, 160).replace(/[<>&]/g, '');
      const ok = await send(
        to,
        `${rows.length} AI jobs failed in the last 30 minutes`,
        [
          `${rows.length} AI jobs ended in error in the last 30 minutes: ${[...byType.entries()]
            .map(([t, n]) => `${t} (${n})`)
            .join(', ')}.`,
          sample ? `One of the errors: ${sample}` : '',
          'The AI Routines page shows each one. You will not get this email again for 2 hours.'
        ].filter(Boolean),
        routinesLink
      );
      if (ok) {
        next.last_failure_email_at = new Date(now).toISOString();
        sent.push(`failures:${rows.length}`);
      }
    }
  }

  // 5. Accounts nearly used up (state lives on each ai_accounts row).
  const { data: accts } = await admin
    .from('ai_accounts')
    .select('label, five_hour_util, seven_day_util, five_hour_resets_at, seven_day_resets_at, alerted_at');
  for (const a of (accts ?? []) as {
    label: string;
    five_hour_util: number | null;
    seven_day_util: number | null;
    five_hour_resets_at: string | null;
    seven_day_resets_at: string | null;
    alerted_at: string | null;
  }[]) {
    const five = Number(a.five_hour_util ?? 0);
    const week = Number(a.seven_day_util ?? 0);
    const high = five >= 0.9 || week >= 0.9;
    if (high && !a.alerted_at && to.length) {
      const which = week >= 0.9 ? 'weekly' : '5-hour';
      const resets = week >= 0.9 ? a.seven_day_resets_at : a.five_hour_resets_at;
      const when = resets
        ? new Date(resets).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit' })
        : 'unknown';
      const ok = await send(
        to,
        `Claude account "${a.label}" is ${Math.round(Math.max(five, week) * 100)}% used`,
        [
          `The Claude account "${a.label}" has used ${Math.round(week * 100)}% of its weekly allowance and ${Math.round(five * 100)}% of its 5-hour allowance. Its ${which} allowance resets ${when} (India time).`,
          'Switch the busy Windows box to another account, or to "auto", on the AI Routines page before it runs out.'
        ],
        routinesLink
      );
      if (ok) {
        await admin.from('ai_accounts').update({ alerted_at: new Date(now).toISOString() }).eq('label', a.label);
        sent.push(`account:${a.label}`);
      }
    } else if (!high && a.alerted_at) {
      await admin.from('ai_accounts').update({ alerted_at: null }).eq('label', a.label);
    }
  }

  // 6. One box dark while the other keeps working.
  // A failed read must not look like "every box is back": skip this rule for the run.
  const { data: boxRows, error: boxErr } = await admin.from('ai_boxes').select('host, agent_seen_at');
  const { data: hostRows, error: hostErr } = await admin.from('ai_runners').select('host, last_seen_at');
  const readFailed = Boolean(boxErr || hostErr);
  if (readFailed) console.error('[ai-engine-watch] box check skipped:', (boxErr ?? hostErr)?.message);
  const dark = readFailed ? (state.dark_boxes ?? []) : darkHosts(
    (hostRows ?? []) as { host: string | null; last_seen_at: string | null }[],
    (boxRows ?? []) as { host: string; agent_seen_at: string | null }[],
    now
  );
  const wasDark = state.dark_boxes ?? [];
  const stillDark = wasDark.filter((h) => dark.includes(h));
  const nowDark = [...stillDark];
  for (const host of dark.filter((h) => !wasDark.includes(h))) {
    if (!to.length) break;
    const name = BOX_NAMES[host] ? `${host} (${BOX_NAMES[host]})` : host;
    const ok = await send(
      to,
      `Windows box ${host} has gone quiet`,
      [
        `Nothing on ${name} has checked in for 10 minutes: none of its JICATE workers, and not its box agent.`,
        'The other box keeps answering AI jobs, but anything running only on this one has stopped. It may be switched off, offline, or stuck at the Windows login screen.',
        'You will get one more email when it is back.'
      ],
      routinesLink
    );
    if (ok) {
      nowDark.push(host);
      sent.push(`box-dark:${host}`);
    }
  }
  for (const host of wasDark.filter((h) => !dark.includes(h))) {
    if (!to.length) {
      nowDark.push(host);
      continue;
    }
    const ok = await send(
      to,
      `Windows box ${host} is back`,
      [`${BOX_NAMES[host] ? `${host} (${BOX_NAMES[host]})` : host} is checking in again.`],
      routinesLink
    );
    if (ok) sent.push(`box-back:${host}`);
    else nowDark.push(host);
  }
  nowDark.sort();
  if (nowDark.length) next.dark_boxes = nowDark;
  else delete next.dark_boxes;

  // 7. Keep account readings fresh: one tiny check job per stored account that is due.
  const probes = await enqueueAccountProbes(admin);

  if (JSON.stringify(next) !== JSON.stringify(state)) await writeState(admin, next);
  return { recipients: to.length, workers, sent, probes };
}
