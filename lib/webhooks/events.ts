import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, BugReportStatus } from '@boobalan_jkkn/shared';

/**
 * Outbound event types. Kept narrow on purpose — every value here becomes part
 * of the public contract that subscribing applications parse.
 */
export const WEBHOOK_EVENTS = ['bug.status_changed', 'bug.note_added'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface StatusChangedPayload {
  event: 'bug.status_changed';
  bug: {
    id: string;
    display_id: string;
    page_url: string;
    reporter_email: string | null;
  };
  from_status: BugReportStatus | null;
  to_status: BugReportStatus;
  note: string | null;
  /**
   * True when this change moved the bug out of a terminal status. A subscribing
   * app usually wants to treat "reopened" differently from any other transition
   * — it means someone disagreed with a fix, not that work progressed.
   */
  reopened: boolean;
  /** Who made the change. `reporter` means the person who filed the bug. */
  actor_kind: 'dashboard_user' | 'api_key' | 'system' | 'reporter';
  occurred_at: string;
}

export interface NoteAddedPayload {
  event: 'bug.note_added';
  bug: {
    id: string;
    display_id: string;
    reporter_email: string | null;
  };
  note: {
    id: string;
    text: string;
    author_kind: string;
    author_email: string | null;
    /**
     * Set when the note carries an image — a screenshot the reporter marked up.
     *
     * Additive on the existing event rather than an event of its own: an
     * annotation IS a note that happens to have a picture attached, and minting
     * `bug.annotation_added` would mean every consumer had to subscribe to a
     * second event just to keep seeing notes it already receives.
     */
    attachment_url?: string | null;
  };
  occurred_at: string;
}

export type WebhookPayload = StatusChangedPayload | NoteAddedPayload;

type AppSettings = NonNullable<Application['settings']>;

/**
 * Whether an application currently wants webhook deliveries.
 *
 * Checked at BOTH enqueue and send time. Re-checking at send time means an app
 * that switches webhooks off drains its queue quietly instead of firing at an
 * endpoint its owner just disabled.
 */
export function webhookTarget(settings: AppSettings | null | undefined): {
  url: string;
  secret: string | null;
} | null {
  const portal = settings?.bug_portal;
  if (!portal?.enabled || !portal.webhook_enabled) return null;

  const url = settings?.webhook_url?.trim();
  if (!url) return null;

  // Refuse anything that isn't an absolute http(s) URL. A malformed value here
  // becomes an outbound request from our infrastructure, so it is validated at
  // the boundary rather than trusted from the settings blob.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return { url, secret: portal.webhook_secret ?? null };
}

/**
 * Queue a delivery. Never throws — a webhook is a side effect, and failing to
 * enqueue one must not roll back the status change that produced it.
 */
export async function enqueueWebhook(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    applicationId: string;
    bugReportId: string;
    settings: AppSettings | null | undefined;
    payload: WebhookPayload;
  }
): Promise<void> {
  const target = webhookTarget(args.settings);
  if (!target) return;

  const { error } = await supabase.from('webhook_deliveries').insert({
    organization_id: args.organizationId,
    application_id: args.applicationId,
    bug_report_id: args.bugReportId,
    event_type: args.payload.event,
    payload: args.payload,
    target_url: target.url,
  });

  if (error) {
    console.error('[webhooks] Failed to enqueue delivery:', error.message);
  }
}
