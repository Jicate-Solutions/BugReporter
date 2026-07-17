'use client';

/**
 * AI Fleet Briefing (₹0 Max lane).
 *
 * A one-click, on-demand read of the whole cross-app bug board. Clicking
 * "Generate briefing" enqueues an internal `brief` job and polls the async
 * Max lane to completion, then renders the answer as three readable blocks:
 * where things stand, what to fix first, and what to watch out for.
 *
 * Fully self-contained: it owns its own state and polling loop and never
 * touches a shared service/hook. AI runs ONLY on an explicit click — never
 * on mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 40; // ~2.5 min ceiling before we give up
const REQUEST_TIMEOUT_MS = 15000; // per-request deadline so a hung fetch can't stall the card forever

type Phase = 'idle' | 'generating' | 'done' | 'error';

interface BriefBlock {
  heading: string;
  body: string;
}

interface EnqueueResponse {
  job_id?: string;
  status?: string;
  retry_after?: number;
  error?: { code?: string; message?: string };
}

interface PollResponse {
  status?: 'pending' | 'running' | 'done' | 'error' | 'canceled';
  result?: { answer?: string } | null;
  error?: string | null;
}

const SECTION_HEADINGS = [
  'Where things stand:',
  'Fix first:',
  'Watch out for:'
] as const;

/** Per-heading accent so the three blocks read as visually distinct. */
const BLOCK_TONE: Record<string, { border: string; heading: string }> = {
  'Where things stand:': {
    border: 'border-l-blue-500',
    heading: 'text-blue-600 dark:text-blue-400'
  },
  'Fix first:': {
    border: 'border-l-amber-500',
    heading: 'text-amber-600 dark:text-amber-400'
  },
  'Watch out for:': {
    border: 'border-l-red-500',
    heading: 'text-red-600 dark:text-red-400'
  }
};

const FALLBACK_TONE = {
  border: 'border-l-muted-foreground/40',
  heading: 'text-foreground'
};

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

/**
 * Split the briefing on its three known headings into ordered blocks. Returns
 * an empty array if none of the headings are present (caller falls back to the
 * raw text so an answer is never swallowed).
 */
function parseBriefing(answer: string): BriefBlock[] {
  const positions = SECTION_HEADINGS.map((heading) => ({
    heading,
    index: answer.indexOf(heading)
  }))
    .filter((p) => p.index !== -1)
    .sort((a, b) => a.index - b.index);

  if (positions.length === 0) return [];

  const blocks: BriefBlock[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].heading.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : answer.length;
    const body = answer.slice(start, end).trim();
    blocks.push({ heading: positions[i].heading, body });
  }
  return blocks;
}

export function AiFleetBriefingCard({
  organizationId,
  applicationId
}: {
  organizationId: string;
  applicationId?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [blocks, setBlocks] = useState<BriefBlock[] | null>(null);
  const [rawAnswer, setRawAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Increments on each run + on unmount; stale async work checks this and bails.
  const runIdRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      // Intentionally WRITE the ref on unmount to invalidate any in-flight
      // poll loop (it checks runIdRef against its captured runId and bails).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runIdRef.current++;
      clearTick();
    };
  }, [clearTick]);

  const generate = useCallback(async () => {
    const runId = ++runIdRef.current;
    setPhase('generating');
    setError(null);
    setBlocks(null);
    setRawAnswer(null);
    setElapsed(0);

    const startedAt = Date.now();
    clearTick();
    tickRef.current = setInterval(() => {
      if (runIdRef.current !== runId) return;
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    const finishError = (message: string) => {
      if (runIdRef.current !== runId) return;
      clearTick();
      setError(message);
      setPhase('error');
    };

    try {
      const enqueueRes = await fetch('/api/internal/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'brief',
          organizationId,
          ...(applicationId ? { applicationId } : {})
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      let enqueueJson: EnqueueResponse;
      try {
        enqueueJson = (await enqueueRes.json()) as EnqueueResponse;
      } catch {
        finishError(`Couldn't start the briefing (HTTP ${enqueueRes.status}).`);
        return;
      }
      if (runIdRef.current !== runId) return;

      if (!enqueueRes.ok || enqueueJson.error || !enqueueJson.job_id) {
        finishError(
          enqueueJson.error?.message ??
            `Couldn't start the briefing (HTTP ${enqueueRes.status}).`
        );
        return;
      }

      const jobId = enqueueJson.job_id;

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await sleep(POLL_INTERVAL_MS);
        if (runIdRef.current !== runId) return;

        let pollJson: PollResponse;
        try {
          const pollRes = await fetch(
            `/api/internal/ai?job_id=${encodeURIComponent(jobId)}&organizationId=${encodeURIComponent(organizationId)}`,
            { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
          );
          pollJson = (await pollRes.json()) as PollResponse;
        } catch {
          // Transient network hiccup — keep polling within the ceiling.
          continue;
        }
        if (runIdRef.current !== runId) return;

        const status = pollJson.status;

        if (status === 'done') {
          const answer = pollJson.result?.answer;
          if (typeof answer === 'string' && answer.trim().length > 0) {
            clearTick();
            const parsed = parseBriefing(answer);
            setBlocks(parsed.length > 0 ? parsed : null);
            setRawAnswer(answer);
            setPhase('done');
          } else {
            finishError('The briefing came back empty. Try regenerating.');
          }
          return;
        }

        if (status === 'error' || status === 'canceled') {
          finishError(
            pollJson.error ??
              (status === 'canceled'
                ? 'The briefing was canceled. Try again.'
                : 'The briefing failed to generate. Try again.')
          );
          return;
        }
        // 'pending' | 'running' | undefined → keep waiting.
      }

      finishError(
        'This is taking longer than expected. The board may be busy — try again in a moment.'
      );
    } catch (e) {
      finishError(
        isTimeoutError(e)
          ? "Couldn't reach the AI in time — it may be busy. Try again."
          : e instanceof Error
            ? e.message
            : 'Something went wrong generating the briefing.'
      );
    }
  }, [organizationId, applicationId, clearTick]);

  const isGenerating = phase === 'generating';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-blue-600" />
          {applicationId ? 'AI Briefing' : 'AI Fleet Briefing'}
        </CardTitle>
        <Badge variant="secondary" className="tabular-nums" title="Runs on the ₹0 Max lane">
          ₹0
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {phase === 'idle' && (
          <p className="text-muted-foreground text-sm">
            {applicationId
              ? "Get a plain-English read of this app's bugs — where things stand, what to fix first, and what to watch out for."
              : 'Get a plain-English read of the entire bug board across every app — where things stand, what to fix first, and what to watch out for.'}
          </p>
        )}

        {isGenerating && (
          <div className="flex items-center gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-4">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Reading the whole board…</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {elapsed}s elapsed · this can take up to a couple of minutes
              </p>
            </div>
          </div>
        )}

        {phase === 'error' && error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-600">{error}</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            {blocks && blocks.length > 0 ? (
              blocks.map((block) => {
                const tone = BLOCK_TONE[block.heading] ?? FALLBACK_TONE;
                return (
                  <div
                    key={block.heading}
                    className={`rounded-md border border-l-4 bg-muted/30 px-3 py-3 ${tone.border}`}
                  >
                    <p className={`text-sm font-semibold ${tone.heading}`}>
                      {block.heading}
                    </p>
                    <p className="text-foreground/90 mt-1 text-sm whitespace-pre-line">
                      {block.body || '—'}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="rounded-md border bg-muted/30 px-3 py-3">
                <p className="text-foreground/90 text-sm whitespace-pre-line">
                  {rawAnswer}
                </p>
              </div>
            )}
            <p className="text-muted-foreground text-xs">Generated just now · ₹0</p>
          </div>
        )}

        <div className="flex items-center gap-2">
          {phase === 'idle' && (
            <Button onClick={generate} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Generate briefing
            </Button>
          )}

          {isGenerating && (
            <Button disabled className="gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </Button>
          )}

          {(phase === 'done' || phase === 'error') && (
            <Button
              onClick={generate}
              variant={phase === 'error' ? 'default' : 'outline'}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {phase === 'error' ? 'Try again' : 'Regenerate'}
            </Button>
          )}

          {phase !== 'idle' && (
            <Badge variant="secondary" className="tabular-nums">
              ₹0
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
