'use client';

/**
 * Possible duplicates (embedding-powered, ₹0).
 *
 * Unlike the AI-route cards, this one uses the pgvector similarity RPC
 * `find_similar_bugs` directly. It grabs the newest active bugs, asks the RPC
 * for each one's closest neighbours, collapses them into de-duplicated pairs,
 * and lets an operator close the *newer* bug of a pair as "won't fix". Nothing
 * runs on mount — the scan is strictly on-demand from the button.
 *
 * The RPC (SECURITY DEFINER) returns rows shaped
 *   { bug_id, display_id, title, description, status, application_id, similarity }
 * and internally scopes to the target bug's organization, so cross-org leakage
 * is not possible here. We still re-read authoritative `created_at` / app names
 * from `bug_reports` because the RPC does not return `created_at`, which we need
 * to decide which bug in a pair is the newer one.
 */

import { useCallback, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';

const MIN_SIMILARITY = 0.85;
const TARGET_LIMIT = 20;

/** Just the target ids + timestamps we seed the scan with. */
type TargetBug = { id: string; created_at: string | null };

/** Defensive view of an RPC result row (field names read leniently). */
type SimilarRow = {
  bug_id?: string | null;
  id?: string | null;
  similarity?: number | string | null;
  description?: string | null;
  display_id?: string | null;
  application_id?: string | null;
};

/** Authoritative row we re-read from bug_reports for display + recency. */
type InfoRow = {
  id: string;
  display_id: string | null;
  description: string | null;
  application_id: string | null;
  created_at: string | null;
};

/** Fully resolved bug used for rendering a pair side. */
type BugInfo = {
  id: string;
  display_id: string | null;
  description: string | null;
  created_at: string | null;
  appName: string;
};

/** One de-duplicated candidate pair (newer first). */
type DuplicatePair = {
  key: string;
  similarity: number;
  newerId: string;
  newer: BugInfo;
  older: BugInfo;
};

function snippet(text: string | null, max = 150): string {
  if (!text) return '(no description)';
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

/** True when `a` was reported more recently than `b`. Deterministic tie-break. */
function isNewer(a: BugInfo, b: BugInfo): boolean {
  const ta = a.created_at ? Date.parse(a.created_at) : 0;
  const tb = b.created_at ? Date.parse(b.created_at) : 0;
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

export function AiDuplicateFinderCard({
  organizationId,
  applicationId
}: {
  organizationId: string;
  applicationId?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const supabase = createClient();

      // 1) Newest active bugs become the similarity targets.
      let targetQuery = supabase
        .from('bug_reports')
        .select('id, created_at')
        .eq('organization_id', organizationId)
        .in('status', ['new', 'seen']);
      if (applicationId) targetQuery = targetQuery.eq('application_id', applicationId);
      const { data: targetData, error: targetErr } = await targetQuery
        .order('created_at', { ascending: false })
        .limit(TARGET_LIMIT);

      if (targetErr) throw new Error(targetErr.message);

      const targets = (targetData ?? []) as TargetBug[];
      if (targets.length === 0) {
        setPairs([]);
        setScanned(true);
        return;
      }

      // 2) Ask the embedding RPC for each target's closest neighbours in parallel.
      //    A target with no embedding simply returns no rows (skipped naturally).
      const rpcResults = await Promise.all(
        targets.map(async (t) => {
          const { data, error: rpcErr } = await supabase.rpc('find_similar_bugs', {
            target_bug_id: t.id,
            min_similarity: MIN_SIMILARITY,
            max_results: 3,
          });
          return {
            targetId: t.id,
            rows: (data ?? []) as SimilarRow[],
            failed: Boolean(rpcErr),
          };
        })
      );

      const rpcFailures = rpcResults.filter((r) => r.failed).length;

      // 3) Reduce each target to its single best match, then collapse A↔B / B↔A
      //    into one pair keyed by the ordered id tuple.
      const pairMap = new Map<string, { aId: string; bId: string; similarity: number }>();
      for (const res of rpcResults) {
        let best: { id: string; sim: number } | null = null;
        for (const row of res.rows) {
          const matchId = row.bug_id ?? row.id ?? null;
          const simRaw = row.similarity;
          const sim = typeof simRaw === 'number' ? simRaw : Number(simRaw);
          if (!matchId || matchId === res.targetId) continue;
          // When scoped to one app, only in-app candidates are eligible — else a
          // cross-app top match would shadow a valid lower-similarity in-app one
          // and a real in-app duplicate would go unreported.
          if (applicationId && row.application_id !== applicationId) continue;
          if (!Number.isFinite(sim) || sim < MIN_SIMILARITY) continue;
          if (!best || sim > best.sim) best = { id: matchId, sim };
        }
        if (!best) continue;

        const [aId, bId] = [res.targetId, best.id].sort();
        const key = `${aId}|${bId}`;
        const existing = pairMap.get(key);
        if (!existing || best.sim > existing.similarity) {
          pairMap.set(key, { aId, bId, similarity: best.sim });
        }
      }

      if (pairMap.size === 0) {
        setPairs([]);
        setScanned(true);
        if (rpcFailures > 0) {
          setError('Some similarity lookups failed. Try scanning again in a moment.');
        }
        return;
      }

      // 4) Authoritative re-read for every bug involved (gives us created_at).
      const involvedIds = Array.from(
        new Set(Array.from(pairMap.values()).flatMap((p) => [p.aId, p.bId]))
      );
      // When scoped to one app, filter the matched side to that app too, so a
      // cross-app match's info row is absent → the pair is dropped at assembly
      // (step 6's `if (!bugA || !bugB) continue`). Pairs therefore stay in-app.
      let infoQuery = supabase
        .from('bug_reports')
        .select('id, display_id, description, application_id, created_at')
        .eq('organization_id', organizationId)
        .in('id', involvedIds);
      if (applicationId) infoQuery = infoQuery.eq('application_id', applicationId);
      const { data: infoData, error: infoErr } = await infoQuery;

      if (infoErr) throw new Error(infoErr.message);
      const infoRows = (infoData ?? []) as InfoRow[];

      // 5) Resolve application names for a friendly label (scoped to this org).
      const appIds = Array.from(
        new Set(
          infoRows
            .map((r) => r.application_id)
            .filter((x): x is string => Boolean(x))
        )
      );
      const appNames: Record<string, string> = {};
      if (appIds.length > 0) {
        const { data: apps } = await supabase
          .from('applications')
          .select('id, name')
          .eq('organization_id', organizationId)
          .in('id', appIds);
        for (const app of (apps ?? []) as { id: string; name: string }[]) {
          appNames[app.id] = app.name;
        }
      }

      const infoMap = new Map<string, BugInfo>();
      for (const r of infoRows) {
        infoMap.set(r.id, {
          id: r.id,
          display_id: r.display_id ?? null,
          description: r.description ?? null,
          created_at: r.created_at ?? null,
          appName: r.application_id
            ? appNames[r.application_id] ?? 'Unknown app'
            : 'Unassigned',
        });
      }

      // 6) Assemble render-ready pairs (newer side first), strongest match on top.
      const built: DuplicatePair[] = [];
      for (const [key, p] of pairMap) {
        const bugA = infoMap.get(p.aId);
        const bugB = infoMap.get(p.bId);
        if (!bugA || !bugB) continue; // a side vanished or was out of scope
        const [newer, older] = isNewer(bugA, bugB) ? [bugA, bugB] : [bugB, bugA];
        built.push({ key, similarity: p.similarity, newerId: newer.id, newer, older });
      }
      built.sort((x, y) => y.similarity - x.similarity);

      setPairs(built);
      setScanned(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Something went wrong while scanning for duplicates.'
      );
    } finally {
      setScanning(false);
    }
  }, [organizationId, applicationId]);

  const markDuplicate = useCallback(
    async (pair: DuplicatePair) => {
      const label = pair.newer.display_id ? `#${pair.newer.display_id}` : 'this bug';
      const ok = window.confirm(
        `Mark ${label} as a duplicate and close it (won't fix)?\n\n` +
          `This is reversible from the bug's own page.`
      );
      if (!ok) return;

      setClosingKey(pair.key);
      try {
        const supabase = createClient();
        const { error: updErr } = await supabase
          .from('bug_reports')
          .update({ status: 'wont_fix' })
          .eq('id', pair.newerId)
          .eq('organization_id', organizationId);

        if (updErr) throw new Error(updErr.message);

        // Drop every pair that references the now-closed bug.
        setPairs((prev) =>
          prev.filter((p) => p.newer.id !== pair.newerId && p.older.id !== pair.newerId)
        );
        toast.success(`${label} marked as duplicate and closed.`);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Could not close the bug. Please try again.'
        );
      } finally {
        setClosingKey(null);
      }
    },
    [organizationId]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-base">Possible duplicates</CardTitle>
        </div>
        <Badge variant="secondary" className="gap-1 text-[10px] font-semibold uppercase tracking-wide">
          <span className="text-green-600">₹0</span> embeddings
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={scan} disabled={scanning} size="sm">
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning…
              </>
            ) : (
              <>
                <Layers className="h-4 w-4" />
                Scan for duplicates
              </>
            )}
          </Button>
          <p className="text-muted-foreground text-xs">
            Compares the newest {TARGET_LIMIT} active bugs by meaning (≥85% similar).
          </p>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {scanning && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comparing bugs by embedding similarity…
          </div>
        )}

        {!scanning && !scanned && !error && (
          <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
            Run a scan to surface bugs that look like duplicates of one another.
          </div>
        )}

        {!scanning && scanned && !error && pairs.length === 0 && (
          <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
            No likely duplicates found.
          </div>
        )}

        {pairs.length > 0 && (
          <div className="space-y-3">
            {pairs.map((pair) => {
              const closing = closingKey === pair.key;
              const sides: Array<{ bug: BugInfo; newer: boolean }> = [
                { bug: pair.newer, newer: true },
                { bug: pair.older, newer: false },
              ];
              return (
                <div key={pair.key} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="secondary" className="tabular-nums">
                      {Math.round(pair.similarity * 100)}% similar
                    </Badge>
                    <span className="text-muted-foreground text-xs">likely duplicate pair</span>
                  </div>

                  <div className="space-y-2">
                    {sides.map(({ bug, newer }) => (
                      <div
                        key={bug.id}
                        className="flex items-start justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {bug.appName}
                            </Badge>
                            {bug.display_id && (
                              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                                #{bug.display_id}
                              </span>
                            )}
                            {newer && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                                newer
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm leading-snug">{snippet(bug.description)}</p>
                        </div>

                        {newer && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => markDuplicate(pair)}
                            disabled={closing}
                            className="shrink-0"
                          >
                            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Mark as duplicate & close
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <p className="text-muted-foreground text-xs">
              Only the newer bug in each pair can be closed. Closing sets it to
              "won&apos;t fix" and is reversible from the bug&apos;s own page.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
