import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { isBugStatus, type AnnotationTool } from '@boobalan_jkkn/shared';
import { getBugPortalConfig, normalizeReporterEmail } from './config';
import {
  canAnnotateFromPortal,
  getAnnotationConfig,
} from '@/lib/services/annotation/config';
import { deriveArea, deriveEnvironment } from './derive';
import type { BugPortalConfig } from './config';

export interface PortalAttachment {
  url: string;
  filename: string;
  filesize?: number;
  filetype?: string;
}

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
  /** The name the reporter gave at intake. Null when the SDK sent none. */
  reporterName: string | null;
  /** The screenshot the reporter captured when filing. Public storage URL. */
  screenshot_url: string | null;
  attachments: PortalAttachment[];
  /** Notes on the thread, excluding internal ones. */
  noteCount: number;
  /** True when the most recent note came from the team, not the reporter. */
  awaitingReporter: boolean;
  /** Most recent note, or the report date when the thread is empty. */
  lastActivityAt: string;
  /** Times this bug has been pushed back open. 0 for almost every bug. */
  reopenCount: number;
  /** Part of the app this came from, read off page_url. Null when unreadable. */
  area: string | null;
  /** Browser and OS, parsed from the captured user agent. Null when unreadable. */
  environment: string | null;
  /** Browser viewport at capture time, e.g. "1366x702". */
  viewport: string | null;
}

export interface PortalBugPage {
  bugs: PortalBugSummary[];
  /** Matches after search and status filtering, before paging. */
  total: number;
  /**
   * How many of those matches are waiting on the reporter. Scoped to the current
   * search/status filter rather than the whole account, so the number beside the
   * toggle always describes the list actually on screen.
   */
  needsReplyTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PortalStatusEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  /** 'reporter' | 'dashboard_user' | 'api_key' | 'system'. Decides attribution. */
  actor_kind: string;
  created_at: string;
}

export interface PortalMessage {
  id: string;
  message_text: string;
  author_kind: string;
  author_email: string | null;
  created_at: string;
  /** Set when the note carries an image — currently, a marked-up screenshot. */
  attachment_url: string | null;
  attachment_type: string | null;
}

export type PortalResolution =
  | {
      ok: true;
      application: PortalApplication;
      reporterEmail: string;
      config: BugPortalConfig;
      /**
       * Whether this reporter may mark up a screenshot from the portal.
       *
       * Resolved here, alongside the portal config, so the two pages that render
       * the button and the route that accepts the upload all read one answer.
       */
      canAnnotate: boolean;
      annotationTools: AnnotationTool[];
    }
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
    canAnnotate: canAnnotateFromPortal(application.settings),
    annotationTools: getAnnotationConfig(application.settings).tools,
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

/**
 * The attachments column is untyped JSONB written by SDK versions that have
 * drifted, so nothing about its shape is guaranteed. Anything without a usable
 * url is dropped rather than rendered as a broken image.
 */
function normalizeAttachments(raw: unknown): PortalAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a): a is Record<string, unknown> =>
        !!a && typeof a === 'object' && typeof (a as any).url === 'string'
    )
    .map((a) => ({
      url: String(a.url),
      filename:
        typeof a.filename === 'string' && a.filename
          ? a.filename
          : String(a.url).split('/').pop() || 'attachment',
      filesize: typeof a.filesize === 'number' ? a.filesize : undefined,
      filetype: typeof a.filetype === 'string' ? a.filetype : undefined,
    }));
}

/**
 * The reporter's own name, as they gave it at intake.
 *
 * Never a column: the SDK writes it into the metadata JSONB alongside the title,
 * so every reader has to dig it out the same way and defend against the same
 * drift. Whitespace and empty strings mean the same thing as absent — a name of
 * " " would otherwise render as a blank where a name should be.
 */
function reporterNameFrom(metadata: unknown): string | null {
  const raw = (metadata as { reporter_name?: unknown } | null)?.reporter_name;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** How many of a reporter's bugs we will ever load for one application. */
export const PORTAL_BUG_LIMIT = 200;

export const PORTAL_PAGE_SIZE = 10;

export type ReporterBugSort = 'newest' | 'oldest' | 'activity';

export const REPORTER_BUG_SORTS: readonly ReporterBugSort[] = [
  'newest',
  'oldest',
  'activity',
] as const;

export function isReporterBugSort(value: unknown): value is ReporterBugSort {
  return (
    typeof value === 'string' &&
    (REPORTER_BUG_SORTS as readonly string[]).includes(value)
  );
}

export interface ReporterBugQuery {
  /** Free text, matched against title, description and display_id. */
  q?: string;
  /** Exact status, or undefined for all. */
  status?: string;
  /** Part of the app, as derived by deriveArea(). */
  area?: string;
  /** Only bugs whose last note came from the team. */
  needsReply?: boolean;
  /** Ordering. Defaults to newest first. */
  sort?: ReporterBugSort;
  /** 1-based page number. */
  page?: number;
  /**
   * Rows per page. Defaults to PORTAL_PAGE_SIZE. The CSV export passes a large
   * value to take everything in one call; the underlying query is still capped
   * at PORTAL_BUG_LIMIT, so this cannot be used to pull an unbounded set.
   */
  pageSize?: number;
}

/** The reporter's own bugs for one application. Never anyone else's. */
export async function listReporterBugs(
  applicationId: string,
  reporterEmail: string,
  query: ReporterBugQuery = {}
): Promise<PortalBugPage> {
  const supabase = createAdminClient();

  const emptyPage: PortalBugPage = {
    bugs: [],
    total: 0,
    needsReplyTotal: 0,
    page: 1,
    pageSize: PORTAL_PAGE_SIZE,
    totalPages: 0,
  };

  let request = supabase
    .from('bug_reports')
    .select(
      'id, display_id, status, category, description, page_url, created_at, resolved_at, metadata, screenshot_url, attachments, reopen_count'
    )
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail);

  // Status is a plain equality, so it is safe to push down to the database.
  if (query.status && isBugStatus(query.status)) {
    request = request.eq('status', query.status);
  }

  const { data, error } = await request
    .order('created_at', { ascending: false })
    .limit(PORTAL_BUG_LIMIT);

  if (error) {
    console.error('[portal] Failed to list bugs:', error);
    return emptyPage;
  }

  let bugs: PortalBugSummary[] = (data || []).map((b) => ({
    id: b.id,
    display_id: b.display_id,
    status: b.status,
    category: b.category,
    description: b.description,
    page_url: b.page_url,
    created_at: b.created_at,
    resolved_at: b.resolved_at,
    title: b.metadata?.title || 'Bug report',
    reporterName: reporterNameFrom(b.metadata),
    screenshot_url: b.screenshot_url ?? null,
    attachments: normalizeAttachments(b.attachments),
    noteCount: 0,
    awaitingReporter: false,
    lastActivityAt: b.created_at,
    reopenCount: b.reopen_count ?? 0,
    area: deriveArea(b.page_url),
    environment: deriveEnvironment(b.metadata?.browser_info),
    viewport:
      typeof b.metadata?.viewport === 'string' ? b.metadata.viewport : null,
  }));

  // Text search runs here rather than in the database, deliberately.
  //
  // `title` lives inside the metadata JSONB, so a server-side search would need
  // a `metadata->>title` term inside a PostgREST logic tree, plus a sanitiser to
  // keep user input from breaking that tree — a parse failure there is a 500 on
  // a page real reporters use. A reporter's own bugs for one application are
  // bounded (200 above; the largest reporter on the platform has 27), so
  // matching in memory is free, has no injection surface at all, and matches the
  // fields users actually search: the title they wrote, the description, and the
  // BUG-123 code they quote back to you.
  const term = query.q?.trim().toLowerCase();
  if (term) {
    bugs = bugs.filter(
      (bug) =>
        bug.title.toLowerCase().includes(term) ||
        bug.description.toLowerCase().includes(term) ||
        bug.display_id.toLowerCase().includes(term) ||
        (bug.area?.toLowerCase().includes(term) ?? false)
    );
  }

  // Area is derived in application code, so it cannot be pushed down to the
  // database the way status is.
  if (query.area) {
    bugs = bugs.filter((bug) => bug.area === query.area);
  }

  // Annotated BEFORE paging, not after.
  //
  // This used to run on the visible page only, which was cheaper but made
  // `awaitingReporter` unusable as a filter — you cannot filter a set on a field
  // that only exists for the ten rows you already chose. The set is bounded at
  // PORTAL_BUG_LIMIT, so this stays one query regardless.
  await attachThreadActivity(supabase, bugs);

  // Counted before the filter is applied, so the toggle keeps showing how many
  // there are once you have switched it on.
  const needsReplyTotal = bugs.filter((bug) => bug.awaitingReporter).length;

  if (query.needsReply) {
    bugs = bugs.filter((bug) => bug.awaitingReporter);
  }

  bugs = sortReporterBugs(bugs, query.sort ?? 'newest');

  const pageSize = Math.max(1, query.pageSize ?? PORTAL_PAGE_SIZE);
  const total = bugs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp rather than 404: landing on page 5 of a list that shrank after a
  // search should show the last page, not an error.
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  const pageBugs = bugs.slice(start, start + pageSize);

  return {
    bugs: pageBugs,
    total,
    needsReplyTotal,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : totalPages,
  };
}

/**
 * Order the list.
 *
 * `activity` is the interesting one: it surfaces threads that have moved
 * recently, which is rarely the same as what was filed recently — a bug from
 * July that the team replied to yesterday is the one the reporter wants to see.
 * Sorted on a copy so the caller's array is not mutated underneath it.
 */
function sortReporterBugs(
  bugs: PortalBugSummary[],
  sort: ReporterBugSort
): PortalBugSummary[] {
  const byTime = (value: string) => new Date(value).getTime();

  return [...bugs].sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return byTime(a.created_at) - byTime(b.created_at);
      case 'activity':
        return byTime(b.lastActivityAt) - byTime(a.lastActivityAt);
      case 'newest':
      default:
        return byTime(b.created_at) - byTime(a.created_at);
    }
  });
}

/**
 * Annotate bugs with note counts, who spoke last, and when.
 *
 * "Has anyone replied to me?" is the question a reporter opens this page to
 * answer, and it is not something a status badge can express — a bug can sit in
 * `new` while the team asks a question on the thread.
 *
 * Runs over the whole matched set rather than just the visible page, because
 * `awaitingReporter` is a filter and a sort key, and neither works on a field
 * that only exists for the ten rows already chosen. Bounded by
 * PORTAL_BUG_LIMIT and chunked below, so it stays a handful of small queries.
 */
async function attachThreadActivity(
  supabase: ReturnType<typeof createAdminClient>,
  bugs: PortalBugSummary[]
): Promise<void> {
  if (bugs.length === 0) return;

  // Chunked because supabase-js serialises `.in()` into the query string. At the
  // 200-bug limit a single call would put ~7.4 KB of UUIDs in the URL, close
  // enough to the usual 8 KB proxy header limit to start returning 414s — and it
  // would only start failing for whichever reporter happened to cross the line.
  const CHUNK = 50;
  const rows: { bug_report_id: string; author_kind: string; created_at: string }[] =
    [];

  for (let i = 0; i < bugs.length; i += CHUNK) {
    const ids = bugs.slice(i, i + CHUNK).map((b) => b.id);
    const { data, error } = await supabase
      .from('bug_report_messages')
      .select('bug_report_id, author_kind, created_at')
      .in('bug_report_id', ids)
      .eq('is_internal', false)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (error) {
      // Non-fatal: the list is still useful without the reply hint.
      console.error('[portal] Failed to load thread activity:', error);
      return;
    }
    rows.push(...(data || []));
  }

  const data = rows;

  const byBug = new Map<
    string,
    { count: number; lastAuthor: string; lastAt: string }
  >();
  // Rows arrive oldest-first, so the last write per bug wins and is the newest.
  for (const row of data || []) {
    const entry = byBug.get(row.bug_report_id) ?? {
      count: 0,
      lastAuthor: '',
      lastAt: '',
    };
    entry.count += 1;
    entry.lastAuthor = row.author_kind;
    entry.lastAt = row.created_at;
    byBug.set(row.bug_report_id, entry);
  }

  for (const bug of bugs) {
    const entry = byBug.get(bug.id);
    if (!entry) continue;
    bug.noteCount = entry.count;
    bug.awaitingReporter = entry.lastAuthor !== 'reporter';
    // Falls back to created_at, already set at construction, when the thread is
    // empty — so `activity` sort has a usable value for every bug.
    bug.lastActivityAt = entry.lastAt || bug.lastActivityAt;
  }
}

/**
 * How many bugs this reporter has in each status.
 *
 * Counted across ALL their bugs, never the filtered set — the point is to answer
 * "has anything moved?" at a glance, which a count that shrinks as you filter
 * cannot do.
 */
export interface ReporterStats {
  total: number;
  byStatus: Record<string, number>;
  /** Distinct areas across all of this reporter's bugs, for the filter. */
  areas: string[];
  /**
   * The name this reporter filed under most recently, for the page header.
   * Resolved here rather than per-bug because the header outlives any one
   * report — and a reporter who changed their name mid-history should be
   * greeted by the current one.
   */
  reporterName: string | null;
  /**
   * Median days from report to close, across this reporter's closed bugs.
   * Null when nothing has closed yet — a median of one number is not a median,
   * and "0d" would read as a claim rather than an absence.
   */
  medianCloseDays: number | null;
  closedCount: number;
}

export async function countReporterBugsByStatus(
  applicationId: string,
  reporterEmail: string
): Promise<ReporterStats> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bug_reports')
    // The name is lifted out with an arrow select rather than by fetching
    // `metadata`: this query spans up to a thousand rows and has no business
    // pulling a JSONB blob per row to read one string off it.
    .select(
      'status, page_url, created_at, resolved_at, reporter_name:metadata->>reporter_name'
    )
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('[portal] Failed to count bugs:', error);
    return {
      total: 0,
      byStatus: {},
      areas: [],
      reporterName: null,
      medianCloseDays: null,
      closedCount: 0,
    };
  }

  const rows = data || [];
  const byStatus: Record<string, number> = {};
  const areaSet = new Set<string>();
  const closeDurations: number[] = [];
  // Rows arrive newest first, so the first name seen is the most recent one.
  let reporterName: string | null = null;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;

    if (!reporterName && typeof row.reporter_name === 'string') {
      reporterName = row.reporter_name.trim() || null;
    }

    const area = deriveArea(row.page_url);
    if (area) areaSet.add(area);

    if (row.resolved_at) {
      const days =
        (new Date(row.resolved_at).getTime() -
          new Date(row.created_at).getTime()) /
        86_400_000;
      // Guard against clock skew or backfilled rows producing negative ages.
      if (days >= 0) closeDurations.push(days);
    }
  }

  return {
    total: rows.length,
    byStatus,
    areas: [...areaSet].sort(),
    reporterName,
    medianCloseDays: median(closeDurations),
    closedCount: closeDurations.length,
  };
}

/** Median, not mean: one bug that sat for a month should not move the number. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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
      'id, display_id, status, category, description, page_url, created_at, resolved_at, metadata, screenshot_url, attachments, reopen_count'
    )
    .eq('id', bugId)
    .eq('application_id', applicationId)
    .eq('reporter_email', reporterEmail)
    .maybeSingle();

  if (!bug) return null;

  const [{ data: events }, { data: messages }] = await Promise.all([
    supabase
      .from('bug_status_events')
      .select('id, from_status, to_status, note, actor_kind, created_at')
      .eq('bug_report_id', bugId)
      .order('created_at', { ascending: true }),
    supabase
      .from('bug_report_messages')
      .select(
        'id, message_text, author_kind, author_email, created_at, attachment_url, attachment_type'
      )
      .eq('bug_report_id', bugId)
      // Internal notes stay with the dev team.
      .eq('is_internal', false)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true }),
  ]);

  const thread = (messages as PortalMessage[]) || [];

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
      reporterName: reporterNameFrom(bug.metadata),
      screenshot_url: bug.screenshot_url ?? null,
      attachments: normalizeAttachments(bug.attachments),
      // Derived from the thread already loaded here — no extra query.
      noteCount: thread.length,
      awaitingReporter:
        thread.length > 0 &&
        thread[thread.length - 1].author_kind !== 'reporter',
      lastActivityAt:
        thread.length > 0
          ? thread[thread.length - 1].created_at
          : bug.created_at,
      reopenCount: bug.reopen_count ?? 0,
      area: deriveArea(bug.page_url),
      environment: deriveEnvironment(bug.metadata?.browser_info),
      viewport:
        typeof bug.metadata?.viewport === 'string'
          ? bug.metadata.viewport
          : null,
    },
    events: (events as PortalStatusEvent[]) || [],
    messages: thread,
  };
}
