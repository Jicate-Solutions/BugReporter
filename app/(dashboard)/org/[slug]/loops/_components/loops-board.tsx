'use client';

/**
 * Loops board — the reporter's Loop Control Tower, welded to the live
 * `loop_registry` (the same table each loop's increment migrations update). It
 * only DISPLAYS: gate flips ship as migrations, exactly like MyJKKN's /admin/loops.
 * So this board can't lie — it lights up gate-by-gate as loops actually ship.
 */

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { Repeat, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type Gates = { a?: string; g?: string; m?: string; f?: string };

type LoopRow = {
  loop_key: string;
  name: string;
  stack_tier: number;
  loop_class: string;
  domain: string | null;
  description: string | null;
  gates: Gates | null;
  routine_id: string | null;
  counter_metric: string | null;
};

// Plain-language meaning of each gate — shown as a legend so a non-engineer can
// read the board. Order matters: it is the maturity path a loop climbs.
const GATE_ORDER: Array<{ key: keyof Gates; label: string; help: string }> = [
  { key: 'a', label: 'Active', help: 'The loop is live and running.' },
  { key: 'g', label: 'Ground truth', help: 'There is a place for a human to record the real answer.' },
  { key: 'm', label: 'Measured', help: 'Humans are actually recording those answers.' },
  { key: 'f', label: 'Learns', help: "The next run changes because of what was measured — not the AI's own guesses." }
];

const CLASS_STYLE: Record<string, string> = {
  self_improving: 'border-green-200 bg-green-100 text-green-800',
  intake: 'border-amber-200 bg-amber-100 text-amber-800',
  cadence: 'border-blue-200 bg-blue-100 text-blue-800',
  accountability: 'border-purple-200 bg-purple-100 text-purple-800',
  infrastructure: 'border-slate-200 bg-slate-100 text-slate-700'
};

const CLASS_LABEL: Record<string, string> = {
  self_improving: 'Self-improving',
  intake: 'Being built',
  cadence: 'Scheduled report',
  accountability: 'Accountability',
  infrastructure: 'Infrastructure'
};

const isOn = (v?: string): boolean => v === 'on';

export function LoopsBoard({ organizationSlug }: { organizationSlug: string }) {
  const [loops, setLoops] = useState<LoopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient() as unknown as SupabaseClient;
        const { data, error: qErr } = await supabase
          .from('loop_registry')
          .select('loop_key,name,stack_tier,loop_class,domain,description,gates,routine_id,counter_metric')
          .eq('is_active', true)
          .order('stack_tier', { ascending: false })
          .order('loop_key', { ascending: true });
        if (qErr) throw new Error(qErr.message);
        if (!cancelled) setLoops((data ?? []) as LoopRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the loops.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="text-destructive h-5 w-5" />
          <p className="text-sm font-medium">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (loops === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading loops…
      </div>
    );
  }

  if (loops.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          No loops registered yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Legend — what the four gates mean, in plain words */}
      <Card className="bg-muted/40">
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {GATE_ORDER.map((g, i) => (
            <div key={g.key} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-green-800">
                {i + 1}. {g.label}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">{g.help}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* One card per loop */}
      <div className="space-y-4">
        {loops.map((loop) => {
          const gates = loop.gates ?? {};
          const earned = GATE_ORDER.filter((g) => isOn(gates[g.key])).length;
          return (
            <Card key={loop.loop_key}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Repeat className="h-4 w-4 shrink-0 text-blue-600" />
                    <CardTitle className="text-base">{loop.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] font-semibold uppercase', CLASS_STYLE[loop.loop_class] ?? '')}
                    >
                      {CLASS_LABEL[loop.loop_class] ?? loop.loop_class}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    {loop.loop_key} · tier {loop.stack_tier}
                    {loop.domain ? ` · ${loop.domain}` : ''}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 tabular-nums text-xs">
                  {earned}/4 gates
                </Badge>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Gate pills — green when earned, grey when not */}
                <div className="flex flex-wrap gap-2">
                  {GATE_ORDER.map((g) => {
                    const on = isOn(gates[g.key]);
                    return (
                      <span
                        key={g.key}
                        title={g.help}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                          on
                            ? 'border-green-200 bg-green-50 text-green-800'
                            : 'border-muted-foreground/20 bg-muted text-muted-foreground'
                        )}
                      >
                        <span
                          className={cn('h-2 w-2 rounded-full', on ? 'bg-green-500' : 'bg-muted-foreground/30')}
                        />
                        {g.label}
                      </span>
                    );
                  })}
                </div>

                {loop.description && (
                  <p className="text-foreground/90 text-sm leading-relaxed">{loop.description}</p>
                )}

                {loop.counter_metric && (
                  <p className="text-muted-foreground text-xs">
                    <span className="font-medium">What it measures:</span> {loop.counter_metric}
                  </p>
                )}

                {loop.routine_id && (
                  <Link
                    href={`/org/${organizationSlug}/routines`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                  >
                    Runs via routine: {loop.routine_id} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
