import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { webhookTarget } from './events';

/**
 * How many times a delivery is attempted before it is abandoned, and how long
 * to wait between attempts. The schedule is deliberately front-loaded (a minute,
 * then five) so a brief blip self-heals quickly, then stretches out so a
 * genuinely broken endpoint is not hammered for hours.
 *
 * Index = attempts already made. Beyond the end of the array, the delivery is
 * marked `error` and left alone; the failure is visible in the app's Settings
 * card, and the corrected /me endpoint still lets the app reconcile by polling.
 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 25;

export interface DispatchSummary {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
  skipped: number;
  pruned: number;
}

interface DeliveryRow {
  id: string;
  application_id: string;
  event_type: string;
  payload: unknown;
  target_url: string;
  attempts: number;
}

/**
 * Build the signature header value.
 *
 * The timestamp is signed alongside the body so a captured request cannot be
 * replayed later — verifying only the body would let anyone who once saw a
 * valid request resend it indefinitely.
 *
 * Receivers verify with:
 *   HMAC_SHA256(secret, `${timestamp}.${rawBody}`) === v1
 */
export function signWebhook(
  rawBody: string,
  secret: string,
  timestamp: number
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Claim and deliver due webhooks for every application on the platform.
 *
 * Deliveries run concurrently and independently: one application's dead endpoint
 * must never delay or fail another's, so every result is settled separately.
 */
export async function runWebhookDispatcher(
  supabase: SupabaseClient
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    claimed: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    pruned: 0,
  };

  const { data: claimed, error: claimError } = await supabase.rpc(
    'fn_webhook_claim_due',
    { p_limit: BATCH_SIZE }
  );

  if (claimError) {
    console.error('[webhooks] Claim failed:', claimError.message);
    return summary;
  }

  const deliveries = (claimed as DeliveryRow[]) || [];
  summary.claimed = deliveries.length;

  if (deliveries.length) {
    // Settings are re-read here, not taken from the queued row. An application
    // that switched webhooks off after enqueueing should not receive the
    // backlog that was already in flight.
    const appIds = Array.from(new Set(deliveries.map((d) => d.application_id)));
    const { data: apps } = await supabase
      .from('applications')
      .select('id, settings')
      .in('id', appIds);

    const settingsById = new Map(
      (apps || []).map((a: { id: string; settings: unknown }) => [a.id, a.settings])
    );

    const results = await Promise.allSettled(
      deliveries.map((delivery) =>
        deliverOne(supabase, delivery, settingsById.get(delivery.application_id))
      )
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        summary.failed += 1;
        continue;
      }
      summary[result.value] += 1;
    }
  }

  const { data: pruned } = await supabase.rpc('fn_webhook_prune', { p_days: 90 });
  summary.pruned = typeof pruned === 'number' ? pruned : 0;

  return summary;
}

type DeliveryOutcome = 'delivered' | 'retrying' | 'failed' | 'skipped';

async function deliverOne(
  supabase: SupabaseClient,
  delivery: DeliveryRow,
  settings: unknown
): Promise<DeliveryOutcome> {
  const target = webhookTarget(settings as never);

  if (!target) {
    await supabase
      .from('webhook_deliveries')
      .update({
        status: 'error',
        last_error: 'Skipped — webhooks are turned off for this application.',
      })
      .eq('id', delivery.id);
    return 'skipped';
  }

  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'BugReporter-Webhook/1.0',
    'X-BugReporter-Event': delivery.event_type,
    'X-BugReporter-Delivery': delivery.id,
  };
  if (target.secret) {
    headers['X-BugReporter-Signature'] = signWebhook(
      rawBody,
      target.secret,
      timestamp
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let responseStatus: number | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      redirect: 'manual',
    });
    responseStatus = response.status;
    if (!response.ok) {
      errorMessage = `Endpoint returned ${response.status}`;
    }
  } catch (err) {
    errorMessage =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `No response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : err.message
        : 'Request failed';
  } finally {
    clearTimeout(timer);
  }

  if (!errorMessage) {
    await supabase
      .from('webhook_deliveries')
      .update({
        status: 'done',
        response_status: responseStatus,
        delivered_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', delivery.id);
    return 'delivered';
  }

  // `attempts` was already incremented by the claim RPC, so it reflects the
  // attempt that just failed.
  const nextDelayMinutes = BACKOFF_MINUTES[delivery.attempts - 1];
  const giveUp = delivery.attempts >= MAX_ATTEMPTS || nextDelayMinutes === undefined;

  await supabase
    .from('webhook_deliveries')
    .update({
      status: giveUp ? 'error' : 'queued',
      response_status: responseStatus,
      last_error: giveUp
        ? `${errorMessage} — gave up after ${delivery.attempts} attempts.`
        : errorMessage,
      next_attempt_at: giveUp
        ? new Date().toISOString()
        : new Date(Date.now() + nextDelayMinutes * 60_000).toISOString(),
    })
    .eq('id', delivery.id);

  return giveUp ? 'failed' : 'retrying';
}
