'use client';

/**
 * Security spotlight (cross-app rollup section).
 *
 * A focused, red-accented panel that surfaces every ACTIVE security-category
 * bug across the whole fleet in one place — the reports that most deserve an
 * operator's eyes today. "Active" means the bug is still new, seen, or in
 * progress; resolved and won't-fix reports are deliberately excluded. Rows are
 * ordered oldest-first so the longest-lingering exposure sits at the top.
 *
 * Self-contained: it does its own scoped fetching (no shared service), reads
 * only real `bug_reports` columns, and joins app names from `applications`.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, CheckCircle2, RotateCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';

/** Raw shape read from bug_reports (only columns that actually exist). */
interface RawSecurityBug {
  id: string;
  application_id: string | null;
  status: string;
  created_at: string;
  description: string | null;
  display_id: string | null;
}

/** A bug enriched with its resolved application name for rendering. */
interface SecurityBugRow extends RawSecurityBug {
  appName: string;
}

interface AppRow {
  id: string;
  name: string;
}

/** How each active status reads in the panel. */
const STATUS_META: Record<string, { label: string; className: string }> = {
  new: { label: 'New', className: 'text-amber-600' },
  seen: { label: 'Seen', className: 'text-amber-600' },
  in_progress: { label: 'In progress', className: 'text-blue-600' }
};

/** Collapse whitespace and cap a description to a readable snippet. */
function snippet(text: string | null, max = 90): string {
  if (!text) return '(no description)';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

/** Age of the bug, from creation to now, as a compact human string. */
function fmtAge(createdAt: string): string {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Older, still-open security bugs read as higher risk. */
function ageTone(createdAt: string): string {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hours >= 24 * 14) return 'text-red-600 font-semibold';
  if (hours >= 24 * 3) return 'text-amber-600';
  return 'text-muted-foreground';
}

export function SecuritySpotlightCard({ organizationId }: { organizationId: string }) {
  const [rows, setRows] = useState<SecurityBugRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // 1. Every ACTIVE (status NOT IN resolved, wont_fix) security bug, oldest
      //    first. Paginated to defeat the PostgREST 1000-row cap.
      const PAGE = 1000;
      const active: RawSecurityBug[] = [];
      let from = 0;
      let done = false;
      while (!done) {
        const { data, error: bugErr } = await supabase
          .from('bug_reports')
          .select('id, application_id, status, created_at, description, display_id')
          .eq('organization_id', organizationId)
          .eq('category', 'security')
          .not('status', 'in', '(resolved,wont_fix)')
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);

        if (bugErr) throw bugErr;

        const batch = (data ?? []) as unknown as RawSecurityBug[];
        active.push(...batch);
        if (batch.length < PAGE) done = true;
        else from += PAGE;
      }

      // 2. Resolve app names — only worth a query when there's something to show.
      let enriched: SecurityBugRow[] = [];
      if (active.length > 0) {
        const { data: appsData, error: appsErr } = await supabase
          .from('applications')
          .select('id, name')
          .eq('organization_id', organizationId);

        if (appsErr) throw appsErr;

        const nameMap = new Map<string, string>();
        ((appsData ?? []) as unknown as AppRow[]).forEach((a) => {
          nameMap.set(a.id, a.name);
        });

        enriched = active.map((b) => ({
          ...b,
          appName: b.application_id
            ? nameMap.get(b.application_id) ?? 'Unknown app'
            : 'Unassigned'
        }));
      }

      setRows(enriched);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong loading security bugs.');
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Loading
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="text-muted-foreground h-4 w-4" />
            Security spotlight
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error — always visible, never null / blank.
  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            Security spotlight
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center">
          <p className="text-sm font-medium text-red-600">
            Couldn&apos;t load the security spotlight
          </p>
          <p className="text-muted-foreground mt-1 text-xs break-words">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  // Empty is the GOOD state for a security panel.
  if (!rows || rows.length === 0) {
    return (
      <Card className="border-green-200 dark:border-green-900/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            Security spotlight
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3 py-6">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-green-600" />
          <div>
            <p className="text-sm font-medium">No open security bugs across the fleet.</p>
            <p className="text-muted-foreground text-xs">
              Every security-category report has been resolved or dropped.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const count = rows.length;

  return (
    <Card className="border-red-200 dark:border-red-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          Security spotlight
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          <span className="text-red-600 font-semibold tabular-nums">{count}</span> active
          security {count === 1 ? 'bug' : 'bugs'} across the fleet — oldest first.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bug</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const meta = STATUS_META[b.status] ?? {
                  label: b.status,
                  className: 'text-muted-foreground'
                };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-[340px] whitespace-normal align-top">
                      <div className="font-medium" title={b.description ?? undefined}>
                        {snippet(b.description)}
                      </div>
                      {b.display_id ? (
                        <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                          {b.display_id}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top font-medium">{b.appName}</TableCell>
                    <TableCell className="align-top">
                      <span className={`text-xs font-medium ${meta.className}`}>{meta.label}</span>
                    </TableCell>
                    <TableCell
                      className={`text-right align-top tabular-nums ${ageTone(b.created_at)}`}
                    >
                      {fmtAge(b.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          &quot;Active&quot; means still new, seen, or in progress — resolved and dropped
          (won&apos;t-fix) reports are excluded. Age counts from when the bug was first
          reported; the oldest open exposures sit at the top.
        </p>
      </CardContent>
    </Card>
  );
}
