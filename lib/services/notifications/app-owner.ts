// Server-only. Takes a service-role client because it reads auth.users through
// the admin API, which no anon/authenticated client can do.
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface AppOwnerRecipient {
  email: string;
  name?: string;
}

/**
 * Who to tell when something happens to an application's bugs.
 *
 * This lookup already existed, inlined in the public bug-report ingestion route.
 * A second caller (reporter reopen) needed the same three steps —
 * applications.created_by_user_id -> auth.admin.getUserById -> email + display
 * name — and copying them would have meant two places to fix when the notion of
 * "who owns this application" grows past its creator.
 *
 * Returns null rather than throwing for every miss: a missing recipient must
 * never fail the operation that triggered the notification. Losing an email is
 * recoverable; losing a status change because nobody could be emailed about it
 * is not.
 */
export async function resolveAppOwnerRecipient(
  supabase: AdminClient,
  applicationId: string
): Promise<AppOwnerRecipient | null> {
  const { data: application, error: appError } = await supabase
    .from('applications')
    .select('created_by_user_id')
    .eq('id', applicationId)
    .maybeSingle();

  if (appError) {
    console.error('[app-owner] Failed to load application:', appError.message);
    return null;
  }
  if (!application?.created_by_user_id) {
    // Applications registered before this column was populated, or created by a
    // user who has since been deleted. Not an error worth shouting about.
    return null;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.admin.getUserById(application.created_by_user_id);

  if (userError || !user?.email) {
    console.error(
      '[app-owner] Failed to load owner auth user:',
      userError?.message
    );
    return null;
  }

  return {
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
  };
}
