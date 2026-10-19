/**
 * Safety alerts — learners who wrote something worrying to an AI coach.
 *
 * Platform admins only (Director decision 2026-10-19: alerts land with him
 * first, and he passes them on). Platform-wide: one engine serves every org.
 * Shows what the learner wrote and what the coach replied, so the admin can
 * judge it; the app that owns the learner (e.g. Plug the Leak) can find who it
 * was from the job id. Nothing here names the learner.
 *
 * Server component.
 */

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ago, isSuperAdmin, readSafetyAlerts } from '@/lib/ai-engine/admin';
import { FollowUpButton } from './_components/follow-up-button';

export const dynamic = 'force-dynamic';

/** The learner's own words from a job payload: their question and answers. */
function learnerWords(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(payload.question);
  walk(payload.answers);
  return out.slice(0, 12).map((s) => (s.length > 400 ? `${s.slice(0, 400)}…` : s));
}

/** One clock read, outside render. */
function nowMs() {
  return Date.now();
}

export default async function SafetyAlertsPage() {
  const session = await createClient();
  const {
    data: { user }
  } = await session.auth.getUser();
  const admin = createAdminClient();

  if (!user || !(await isSuperAdmin(admin, user.id))) {
    return (
      <div className="rounded-md border p-6">
        <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Safety alerts are for platform admins only. Contact the platform admin.
        </p>
      </div>
    );
  }

  const alerts = await readSafetyAlerts(admin);
  const open = alerts.filter((a) => !a.followed_up_at);
  const now = nowMs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Safety alerts</h1>
        <p className="text-muted-foreground text-sm">
          When a learner writes something worrying to an AI coach, the coach replies kindly, tells
          them to talk to a trusted adult, and raises an alert here. Read each one, pass it to the
          right person, then mark it followed up.
        </p>
      </div>

      {alerts.length === 0 && (
        <p className="text-muted-foreground text-sm">No safety alerts yet.</p>
      )}

      {alerts.map((a) => {
        const words = learnerWords(a.payload);
        return (
          <Card
            key={a.id}
            className={a.followed_up_at ? 'opacity-70' : 'border-red-300 dark:border-red-800'}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {a.followed_up_at ? (
                  <Badge variant="secondary">followed up {ago(a.followed_up_at, now)}</Badge>
                ) : (
                  <Badge variant="destructive">needs follow-up</Badge>
                )}
                <span>{a.app_slug}</span>
                <span className="text-muted-foreground text-sm font-normal">
                  {ago(a.created_at, now)} · {new Date(a.created_at).toLocaleString('en-IN')}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">The learner wrote</p>
                {words.length ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {words.map((w, i) => (
                      <li key={i} className="whitespace-pre-wrap">
                        {w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Not available (the job has been cleared after 90 days).
                  </p>
                )}
              </div>
              {a.answer && (
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium">The coach replied</p>
                  <p className="whitespace-pre-wrap">{a.answer}</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-muted-foreground text-xs">job {a.job_id ?? '—'}</code>
                {!a.followed_up_at && <FollowUpButton id={a.id} />}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {open.length === 0 && alerts.length > 0 && (
        <p className="text-muted-foreground text-xs">Every alert has been followed up.</p>
      )}
    </div>
  );
}
