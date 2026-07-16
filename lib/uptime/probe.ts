/**
 * Uptime probing (Phase 2 — uptime board).
 *
 * The tower pings each app's registered public URL. Zero coupling: apps need no
 * code change to be monitored. Apps registered with localhost/private URLs are
 * classified "unmonitored" (not "down" — that would be noise, not truth).
 *
 * "Up" means the server ANSWERED (any HTTP status, including 401/404): the
 * process is alive and serving. "Down" means no HTTP response at all
 * (DNS failure, connection refused, timeout).
 */

const PROBE_TIMEOUT_MS = 8000;

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export interface ProbeResult {
  application_id: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
}

/** Can this URL be reached from the cloud at all? */
export function isProbeable(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (PRIVATE_HOST_RE.test(u.hostname)) return false;
    if (u.hostname.endsWith('.invalid') || u.hostname.endsWith('.local')) return false;
    if (!u.hostname.includes('.')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function probeUrl(
  applicationId: string,
  url: string
): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'JKKN-ControlTower-UptimeProbe/1.0' }
    });
    return {
      application_id: applicationId,
      ok: true,
      status_code: res.status,
      latency_ms: Date.now() - started,
      error: null
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `timeout after ${PROBE_TIMEOUT_MS}ms`
          : err.message.slice(0, 200)
        : 'unknown error';
    return {
      application_id: applicationId,
      ok: false,
      status_code: null,
      latency_ms: Date.now() - started,
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe many apps concurrently; skips unprobeable URLs. */
export async function probeApps(
  apps: Array<{ id: string; app_url: string | null }>
): Promise<{ results: ProbeResult[]; skipped: number }> {
  const probeable = apps.filter((a) => isProbeable(a.app_url));
  const results = await Promise.all(
    probeable.map((a) => probeUrl(a.id, a.app_url as string))
  );
  return { results, skipped: apps.length - probeable.length };
}
