/**
 * Internal AI route — the live task catalogue, for the dashboard's own UI.
 *
 *   GET /api/internal/ai/job-types
 *     → { tasks: [{ key, label, description, enabled }], live: boolean }
 *
 * `live` says whether the tasks came from MyJKKN (true) or from the offline
 * snapshot (false). The caller needs it to tell "this app is approved for a
 * task MyJKKN has withdrawn" apart from "we simply couldn't reach MyJKKN".
 *
 * WHY THIS EXISTS. The application form (apps/_components/application-form.tsx)
 * renders the "Approved AI tasks" tick-list, and it is a client component — as
 * are both of its parent pages (apps/new and apps/[appSlug]/edit). There is no
 * server component anywhere in that chain to read the catalogue and pass it
 * down as a prop, and the read needs MYJKKN_AI_KEY, which must never reach a
 * browser bundle. So the client fetches it from here instead — the same shape
 * three other client components already use against /api/internal/ai and
 * /api/internal/routines/run.
 *
 * Auth: any signed-in reporter user. Unlike /api/internal/ai this returns no
 * organization-scoped data — the catalogue is platform-wide and identical for
 * every org — so there is nothing to scope to a membership check. It is still
 * gated on a session because the task menu is internal operational detail, not
 * public API surface.
 *
 * Never returns prompt_template: getAvailableAiTasks() does not request it.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAvailableAiTasks } from '@/lib/ai/tasks';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to view AI tasks.' } },
      { status: 401 }
    );
  }

  // Never throws: falls back to the offline snapshot if MyJKKN is unreachable,
  // so the tick-list always renders something usable.
  const { tasks, live } = await getAvailableAiTasks();
  return NextResponse.json(
    { tasks, live },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
