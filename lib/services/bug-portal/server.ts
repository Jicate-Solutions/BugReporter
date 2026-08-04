import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBugPortalConfig, normalizeReporterEmail } from './config';
import type { BugPortalConfig } from './config';

export interface PortalBugSummary {
  id: string;
  display_id: string;
  status: string;
  category: string | null;
  description: string;
  page_url: string;
  created_at: string;
  resolved_at: string | null;
  title: string;
}

export interface PortalStatusEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
}

export interface PortalMessage {
  id: string;
  message_text: string;
  author_kind: string;
  author_email: string | null;
  created_at: string;
}

export type PortalResolution =
  | { ok: true; application: PortalApplication; reporterEmail: string; config: BugPortalConfig }
  | { ok: false; reason: 'not_found' | 'disabled' | 'missing_reporter' | 'bad_signature' };

export interface PortalApplication {
  id: string;
  name: string;
  slug: string;
  organization_id: string;
}

/**
 * Resolve a portal request into an application + reporter, or a refusal.
 *
 * Fully tenant-generic: the application is looked up by slug at request time, so
 * a newly registered application works the moment its owner flips the switch —
 * nothing here knows how many applications exist or which ones they are.
 */
export async function resolvePortalRequest(
  appSlug: string,
  rawEmail: string | undefined,
  signature: string | undefined
): Promise<PortalResolution> {
  const supabase = createAdminClient();

  const { data: application } = await supabase
    .from('applications')
    .select('id, name, slug, organization_id, settings')
    .eq('slug', appSlug)
    .maybeSingle();

  if (!application) return { ok: false, reason: 'not_found' };

  const config = getBugPortalConfig(application.settings);

  // A disabled portal is indistinguishable from a non-existent one. Reporting
  // "disabled" would confirm that an application with this slug exists.
  if (!config.enabled) return { ok: false, reason: 'not_found' };

  const reporterEmail = normalizeReporterEmail(rawEmail);
  if (!reporterEmail) return { ok: false, reason: 'missing_reporter' };

  if (config.requireSignature) {
    if (!config.webhookSecret || !signature) {
      return { ok: false, reason: 'bad_signature' };
    }
    if (!verifyPortalSignature(reporterEmail, signature, config.webhookSecret)) {
      return { ok: false, reason: 'bad_signature' };
    }
  }

  return {
    ok: true,
    application: {
      id: application.id,
      name: application.name,
      slug: application.slug,
      organization_id: application.organization_id,
    },
    reporterEmail,
    config,
  };
}

/**
 * Constant-time comparison of an HMAC over the reporter email.
 *
 * A plain `===` here would leak the expected signature one byte at a time to a
 * caller willing to measure response timings.
 */
export function verifyPortalSignature(
  reporterEmail: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac('sha256', secret).update(reporterEmail).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The reporter's own bugs for one application. Never anyone else's. */
export async function listReporterBugs(
  applicationId: string,
  reporterEmail: string
): Promise<PortalBugSummary[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bug_reports')
    .select(
      'id, display_id, status, category, description, page_url, created_at, resolved_at, metadata'
    )
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[portal] Failed to list bugs:', error);
    return [];
  }

  return (data || []).map((b) => ({
    id: b.id,
    display_id: b.display_id,
    status: b.status,
    category: b.category,
    description: b.description,
    page_url: b.page_url,
    created_at: b.created_at,
    resolved_at: b.resolved_at,
    title: b.metadata?.title || 'Bug report',
  }));
}

/** One bug plus its timeline and thread — scoped to app AND reporter. */
export async function getReporterBug(
  applicationId: string,
  reporterEmail: string,
  bugId: string
): Promise<{
  bug: PortalBugSummary;
  events: PortalStatusEvent[];
  messages: PortalMessage[];
} | null> {
  const supabase = createAdminClient();

  const { data: bug } = await supabase
    .from('bug_reports')
    .select(
      'id, display_id, status, category, description, page_url, created_at, resolved_at, metadata'
    )
    .eq('id', bugId)
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail)
    .maybeSingle();

  if (!bug) return null;

  const [{ data: events }, { data: messages }] = await Promise.all([
    supabase
      .from('bug_status_events')
      .select('id, from_status, to_status, note, created_at')
      .eq('bug_report_id', bugId)
      .order('created_at', { ascending: true }),
    supabase
      .from('bug_report_messages')
      .select('id, message_text, author_kind, author_email, created_at')
      .eq('bug_report_id', bugId)
      // Internal notes stay with the dev team.
      .eq('is_internal', false)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true }),
  ]);

  return {
    bug: {
      id: bug.id,
      display_id: bug.display_id,
      status: bug.status,
      category: bug.category,
      description: bug.description,
      page_url: bug.page_url,
      created_at: bug.created_at,
      resolved_at: bug.resolved_at,
      title: bug.metadata?.title || 'Bug report',
    },
    events: (events as PortalStatusEvent[]) || [],
    messages: (messages as PortalMessage[]) || [],
  };
}
