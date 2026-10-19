/**
 * AI engine watch — two emails to the Director (decisions 2026-10-19):
 *
 *   1. Workers down: no JICATE worker has checked in for 15 minutes → one email.
 *      One more when a worker is back. Never repeated while the state holds.
 *   2. Safety alerts: open alerts raised since the last email → one email, at
 *      most once an hour; alerts raised in between are counted in the next one.
 *      The email carries counts and a link only, never the learner's words.
 *
 * Recipient: AI_ALERT_EMAIL (comma-separated allowed). Unset → nothing is sent
 * and the run says so. State lives in ai_engine_watch. Called by the cron route.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const DOWN_AFTER_MS = 15 * 60_000;
const SAFETY_EMAIL_GAP_MS = 60 * 60_000;

export interface WatchSummary {
  recipients: number;
  workers: 'up' | 'down' | 'none-registered';
  sent: string[];
}

interface WatchState {
  workers_down?: boolean;
  last_safety_email_at?: string;
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

  if (JSON.stringify(next) !== JSON.stringify(state)) await writeState(admin, next);
  return { recipients: to.length, workers, sent };
}
