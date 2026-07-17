'use client';

/**
 * AI Triage helper (₹0 Max lane).
 *
 * Loads the newest ACTIVE bugs (status new/seen) for the org and lets an
 * operator ask the AI — on demand, per bug — to summarize it, suggest a fix,
 * or categorize it. Every AI action is async: enqueue against the internal
 * route, poll to completion, reveal the answer inline under that row. One run
 * per row at a time; other rows stay usable throughout. Purely a new read plus
 * on-click AI calls — no schema change, no shared file touched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  FileText,
  Wrench,
  Tags,
  RefreshCw,
  Inbox
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

type TriageTask = 'bug.summarize' | 'bug.suggest_fix' | 'bug.categorize';

interface ActiveBug {
  id: string;
  display_id: string | null;
  description: string | null;
  created_at: string;
}

interface RunState {
  task: TriageTask;
  phase: 'thinking' | 'done' | 'error';
  answer: string | null;
  error: string | null;
}

interface EnqueueResponse {
  job_id?: string;
  status?: string;
  retry_after?: number;
  error?: { code?: string; message?: string };
}

interface PollResponse {
  status: 'pending' | 'running' | 'done' | 'error' | 'canceled';
  result: { answer?: string } | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 40; // ~2.5 min ceiling
const REQUEST_TIMEOUT_MS = 15000; // per-request deadline so a hung fetch can't stall a row forever

const TASK_META: Record<
  TriageTask,
  { label: string; icon: typeof FileText }
> = {
  'bug.summarize': { label: 'Summarize', icon: FileText },
  'bug.suggest_fix': { label: 'Suggest fix', icon: Wrench },
  'bug.categorize': { label: 'Categorize', icon: Tags }
};

const TASK_ORDER: TriageTask[] = [
  'bug.summarize',
  'bug.suggest_fix',
  'bug.categorize'
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True for an AbortSignal.timeout() rejection (a per-request deadline hit).
 * Detected by name, not `instanceof Error`, because AbortSignal.timeout()
 * rejects with a DOMException, and `DOMException instanceof Error` is false
 * in Chrome/Firefox.
 */
function isTimeoutError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'TimeoutError';
}

/** Compact "how long ago" from an ISO timestamp. */
function formatRelativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** One-line, trimmed preview of the bug description. */
function snippet(text: string | null): string {
  if (!text) return '(no description provided)';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '(no description provided)';
  return clean.length <= 140 ? clean : `${clean.slice(0, 140)}…`;
}

/** Pretty-print the categorize JSON string; fall back to the raw text. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AiTriageHelperCard({
  organizationId
}: {
  organizationId: string;
}) {
  const [bugs, setBugs] = useState<ActiveBug[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  const mountedRef = useRef(true);
  // Synchronous per-row guard: prevents a double-click (or React StrictMode's
  // dev-only double-invoke) from enqueuing the same bug twice. Kept in a ref so
  // the check never depends on async React state flushing.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadBugs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('bug_reports')
        .select('id, display_id, description, created_at')
        .eq('organization_id', organizationId)
        .in('status', ['new', 'seen'])
        .order('created_at', { ascending: false })
        .limit(8);

      if (error) throw new Error(error.message);
      if (!mountedRef.current) return;
      setBugs((data ?? []) as ActiveBug[]);
    } catch (e) {
      if (!mountedRef.current) return;
      setLoadError(
        e instanceof Error ? e.message : 'Failed to load active bugs.'
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadBugs();
  }, [loadBugs]);

  const runTriage = useCallback(
    async (bugId: string, task: TriageTask) => {
      // One run per row — guard synchronously via a ref (pure state updaters).
      if (inFlightRef.current.has(bugId)) return;
      inFlightRef.current.add(bugId);

      setRuns((prev) => ({
        ...prev,
        [bugId]: { task, phase: 'thinking', answer: null, error: null }
      }));

      const settle = (next: RunState) => {
        inFlightRef.current.delete(bugId);
        if (!mountedRef.current) return;
        setRuns((prev) => ({ ...prev, [bugId]: next }));
      };
      const fail = (msg: string) =>
        settle({ task, phase: 'error', answer: null, error: msg });

      try {
        const enqRes = await fetch('/api/internal/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'triage',
            organizationId,
            bugId,
            task
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        let enqJson: EnqueueResponse;
        try {
          enqJson = (await enqRes.json()) as EnqueueResponse;
        } catch {
          fail(`Couldn't start the AI job (HTTP ${enqRes.status}).`);
          return;
        }

        if (!enqRes.ok || !enqJson.job_id) {
          fail(
            enqJson.error?.message ||
              `Couldn't start the AI job (HTTP ${enqRes.status}).`
          );
          return;
        }

        const jobId = enqJson.job_id;

        for (let i = 0; i < MAX_POLLS; i++) {
          await sleep(POLL_INTERVAL_MS);
          if (!mountedRef.current) {
            inFlightRef.current.delete(bugId);
            return;
          }

          let pollJson: PollResponse;
          try {
            const pollRes = await fetch(
              `/api/internal/ai?job_id=${encodeURIComponent(
                jobId
              )}&organizationId=${encodeURIComponent(organizationId)}`,
              { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
            );
            pollJson = (await pollRes.json()) as PollResponse;
          } catch {
            // Transient network hiccup — keep polling.
            continue;
          }

          if (pollJson.status === 'done') {
            settle({
              task,
              phase: 'done',
              answer: pollJson.result?.answer ?? '',
              error: null
            });
            return;
          }

          if (pollJson.status === 'error' || pollJson.status === 'canceled') {
            fail(pollJson.error || `The AI job ${pollJson.status}.`);
            return;
          }
          // 'pending' | 'running' → keep waiting.
        }

        fail('Timed out waiting for the AI (over 2 minutes). Please try again.');
      } catch (e) {
        fail(
          isTimeoutError(e)
            ? "Couldn't reach the AI in time — it may be busy. Try again."
            : e instanceof Error
              ? e.message
              : 'Something went wrong running the AI.'
        );
      }
    },
    [organizationId]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <CardTitle className="text-base">AI Triage helper</CardTitle>
          <Badge
            variant="outline"
            className="border-green-500/40 text-green-600"
          >
            ₹0
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void loadBugs()}
          disabled={loading}
          title="Refresh active bugs"
          aria-label="Refresh active bugs"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>

      <CardContent>
        <p className="text-muted-foreground mb-4 text-xs">
          The 8 newest bugs still waiting on a first look. Ask the AI to
          summarize, suggest a fix, or categorize any of them — runs on the free
          Max lane.
        </p>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : loadError ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-red-600">
              Couldn&apos;t load active bugs
            </p>
            <p className="text-muted-foreground mt-1 text-xs">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void loadBugs()}
            >
              Try again
            </Button>
          </div>
        ) : bugs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              Nothing waiting to triage — all caught up.
            </p>
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {bugs.map((bug) => {
              const run = runs[bug.id];
              const thinking = run?.phase === 'thinking';

              return (
                <li key={bug.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {bug.display_id ? (
                          <span className="text-muted-foreground font-mono text-xs">
                            {bug.display_id}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground text-xs">
                          {formatRelativeAge(bug.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{snippet(bug.description)}</p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {TASK_ORDER.map((task) => {
                        const meta = TASK_META[task];
                        const Icon = meta.icon;
                        const isThisRunning = thinking && run?.task === task;
                        return (
                          <Button
                            key={task}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => void runTriage(bug.id, task)}
                            disabled={thinking}
                            aria-busy={isThisRunning}
                          >
                            {isThisRunning ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Icon className="h-3 w-3" />
                            )}
                            {meta.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Per-row status / result */}
                  {thinking ? (
                    <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>
                        thinking… ({TASK_META[run.task].label.toLowerCase()})
                      </span>
                    </div>
                  ) : run?.phase === 'error' ? (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      {run.error}
                    </p>
                  ) : run?.phase === 'done' && run.answer ? (
                    <div className="bg-muted/40 mt-2 rounded-md border p-3">
                      <div className="text-muted-foreground mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide">
                        {(() => {
                          const Icon = TASK_META[run.task].icon;
                          return <Icon className="h-3 w-3" />;
                        })()}
                        {TASK_META[run.task].label}
                      </div>
                      {run.task === 'bug.categorize' ? (
                        <pre className="text-foreground overflow-x-auto text-xs">
                          {prettyJson(run.answer)}
                        </pre>
                      ) : (
                        <p className="text-foreground whitespace-pre-line text-sm">
                          {run.answer}
                        </p>
                      )}
                    </div>
                  ) : run?.phase === 'done' && !run.answer ? (
                    <p className="text-muted-foreground mt-2 text-xs italic">
                      The AI returned an empty answer.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
