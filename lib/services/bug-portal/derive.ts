/**
 * Pure derivations over what the SDK captured.
 *
 * Kept free of any Supabase or Next import on purpose: these are the two places
 * the portal infers something the database does not store, which makes them the
 * two places most worth being able to run in isolation and check against real
 * captured values.
 */

/** Container segments that carry no meaning as a facet. */
const GENERIC_SEGMENTS = new Set([
  'masters',
  'master',
  'app',
  'dashboard',
  'admin',
  'pages',
]);

/**
 * Which part of the application a report came from, derived from `page_url`.
 *
 * There is no module column and the SDK does not send one, but the path is
 * structured enough to carry the answer. Across Raagam-Export's reports the
 * first segment is `masters` on 49 of 50 — useless as a facet — so this reads
 * past known container segments to the one that actually varies, giving
 * Materials / Associates / Orders.
 *
 * Surfaced as "Where" rather than "Module" on purpose. It is derived from the
 * page the report was filed on, and the SDK captures that URL when the widget
 * opens rather than when it is submitted, so it is occasionally the previous
 * page. A column called Module would claim more authority than the data has.
 */
export function deriveArea(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;

  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    // A relative value is still usable, but only if it actually looks like a
    // path. Without this guard any junk string becomes an area: "not a url"
    // title-cases straight through to "Not A Url" and appears in the filter
    // dropdown as though it were a real part of the application.
    const stripped = pageUrl.replace(/^https?:\/\/[^/]+/, '');
    if (!stripped.startsWith('/')) return null;
    path = stripped;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const pick =
    segments.length > 1 && GENERIC_SEGMENTS.has(segments[0].toLowerCase())
      ? segments[1]
      : segments[0];

  // A path segment that is an id, a slug of digits, or a uuid is not a place.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(pick) || /^\d+$/.test(pick)) return null;

  return titleCaseSegment(pick);
}

function titleCaseSegment(segment: string): string {
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * A readable environment line from the raw user agent the SDK captured.
 *
 * `system_info` is null on every report, so the UA string is the only source.
 * Parsing a UA is unreliable by nature, so this claims only what it can read and
 * returns null rather than guessing — a blank Browser row is honest, a wrong one
 * is not.
 *
 * Order matters: Edge and Opera both carry `Chrome/` in their UA, so they have
 * to be tested first or every Edge user is reported as Chrome.
 */
export function deriveEnvironment(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string' || !userAgent) return null;

  const browser = matchFirst(userAgent, [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/(?:FxiOS|Firefox)\/(\d+)/, 'Firefox'],
    [/(?:CriOS|Chrome)\/(\d+)/, 'Chrome'],
    // Mobile Safari puts "Mobile/15E148" between the version and the Safari
    // token, so the two cannot be required to be adjacent.
    [/Version\/(\d+)[\d._]*(?:.*)\bSafari\//, 'Safari'],
  ]);

  // iOS before macOS, and Android before Linux. Both pairs are subsets: an
  // iPhone's user agent contains the literal "like Mac OS X", and Android's
  // contains "Linux". Testing the general case first labels every iPhone a Mac.
  const os = /(iPhone|iPad|iPod)/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;

  if (!browser && !os) return null;
  return [browser, os].filter(Boolean).join(' · ');
}

function matchFirst(
  input: string,
  patterns: [RegExp, string][]
): string | null {
  for (const [pattern, name] of patterns) {
    const match = pattern.exec(input);
    if (match) return `${name} ${match[1]}`;
  }
  return null;
}
