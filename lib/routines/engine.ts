/**
 * MyJKKN AI Door client for the routine dispatcher (server-side, ₹0 Max lane).
 *
 * Unlike the internal AI route (session-authed), the dispatcher runs on a cron
 * with no session, so it calls the Door directly with MYJKKN_AI_KEY, tagged
 * app_id = reporter-<organizationId> (per-org isolation — unchanged).
 */

export interface EngineConfig {
  base: string;
  key: string;
}

export function engineConfig(): EngineConfig | null {
  const base = process.env.MYJKKN_AI_URL;
  const key = process.env.MYJKKN_AI_KEY;
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ''), key };
}

export const appIdFor = (organizationId: string) => `reporter-${organizationId}`;

const TIMEOUT_MS = 20000;

export interface EnqueueResult {
  jobId: string | null;
  error: string | null;
}

export async function enqueueJob(
  cfg: EngineConfig,
  organizationId: string,
  task: string,
  payload: Record<string, string>,
  dedupeKey?: string
): Promise<EnqueueResult> {
  try {
    const res = await fetch(`${cfg.base}/api/b2a/ai/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appIdFor(organizationId),
        task,
        payload,
        ...(dedupeKey ? { dedupe_key: dedupeKey } : {})
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = (await res.json().catch(() => null)) as {
      job_id?: string;
      error?: { message?: string };
    } | null;
    if (res.status === 202 && data?.job_id) return { jobId: data.job_id, error: null };
    return { jobId: null, error: data?.error?.message ?? `engine returned HTTP ${res.status}` };
  } catch (e) {
    return { jobId: null, error: e instanceof Error ? e.message : 'engine unreachable' };
  }
}

export interface PollResult {
  status: 'pending' | 'running' | 'done' | 'error' | 'canceled' | 'unknown';
  answer: string | null;
  error: string | null;
}

export async function pollJob(
  cfg: EngineConfig,
  organizationId: string,
  jobId: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<PollResult> {
  try {
    const res = await fetch(
      `${cfg.base}/api/b2a/ai/run?job_id=${encodeURIComponent(jobId)}&app_id=${encodeURIComponent(appIdFor(organizationId))}`,
      { headers: { Authorization: `Bearer ${cfg.key}` }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }
    );
    const data = (await res.json().catch(() => null)) as {
      status?: string;
      result?: { answer?: string } | null;
      error?: string | null;
    } | null;
    if (!res.ok || !data) return { status: 'unknown', answer: null, error: `poll HTTP ${res.status}` };
    const status = (data.status ?? 'unknown') as PollResult['status'];
    return { status, answer: data.result?.answer ?? null, error: data.error ?? null };
  } catch (e) {
    return { status: 'unknown', answer: null, error: e instanceof Error ? e.message : 'poll failed' };
  }
}
