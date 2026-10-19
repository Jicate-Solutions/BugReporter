/**
 * Red banner on the AI pages when a safety alert is waiting. Renders nothing
 * for anyone who is not a platform admin, or when nothing is open.
 * Server component.
 */

import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countOpenSafetyAlerts, isSuperAdmin } from '@/lib/ai-engine/admin';

export async function SafetyAlertBanner({
  admin,
  userId,
  slug
}: {
  admin: SupabaseClient;
  userId: string | null | undefined;
  slug: string;
}) {
  if (!userId || !(await isSuperAdmin(admin, userId))) return null;
  const open = await countOpenSafetyAlerts(admin);
  if (open === 0) return null;
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {open === 1
        ? 'A learner wrote something worrying to an AI coach.'
        : `${open} learners wrote something worrying to an AI coach.`}{' '}
      <Link href={`/org/${slug}/ai/safety`} className="font-medium underline">
        Read the safety alerts
      </Link>
      .
    </div>
  );
}
