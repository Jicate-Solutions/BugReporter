import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBugPortalConfig } from '@/lib/services/bug-portal/config';
import type { Application } from '@boobalan_jkkn/shared';

/**
 * Discovery for the Bug Status Portal.
 *
 * The feature is opt-in and lives on a Settings sub-page, so without a prompt
 * here nobody who hasn't been told about it would ever find it. Shown only once
 * an application has actually received bugs — offering it to an app with nothing
 * to report would be noise.
 */
export function BugPortalPrompt({
  application,
  orgSlug,
  totalBugs,
}: {
  application: Application;
  orgSlug: string;
  totalBugs: number;
}) {
  const config = getBugPortalConfig(application.settings);

  if (config.enabled || totalBugs === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2">
          <MessagesSquare className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">
            Let reporters track their own bugs
          </p>
          <p className="text-sm text-muted-foreground">
            Turn on the Bug Status Portal and the people reporting bugs in{' '}
            {application.name} can see status updates and exchange notes with
            your team — one link, no code changes.
          </p>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={`/org/${orgSlug}/apps/${application.slug}/edit`}>
          Set it up
        </Link>
      </Button>
    </div>
  );
}
