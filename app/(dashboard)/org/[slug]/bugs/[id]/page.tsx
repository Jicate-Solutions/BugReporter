'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBugReport } from '@/hooks/bug-reports/use-bug-reports';
import { useOrganizationContext } from '@/hooks/organizations/use-organization-context';
import { BugStatusBadge } from '../_components/bug-status-badge';
import { BugReportClientService } from '@/lib/services/bug-reports/client';
import { ConsoleLogsSection } from './_components/console-logs-section';
import { NetworkTraceSection } from './_components/network-trace-section';
import { SimilarBugsCard } from './_components/similar-bugs-card';
import { AttachmentsSection } from './_components/attachments-section';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { BUG_STATUSES, BUG_STATUS_LABELS, bugStatusLabel } from '@boobalan_jkkn/shared';
import { StatusChangeDialog } from './_components/status-change-dialog';

export default function BugDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const { organization } = useOrganizationContext();
  const { bug, loading, refreshing, refetch } = useBugReport(id);
  const [isUpdating, setIsUpdating] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!bug || !organization) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Bug report not found</p>
        <Button asChild variant="outline">
          <Link href={`/org/${organization?.slug}/bugs`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Bugs
          </Link>
        </Button>
      </div>
    );
  }

  const title = bug.title || 'Untitled Bug Report';
  const reporterName = bug.reporter_name;
  const reporterEmail = bug.reporter_email;

  // Selecting a status opens the note dialog rather than writing immediately —
  // the note is the reporter-facing half of a status change, and asking for it
  // after the fact means it never gets written.
  const handleStatusChange = async (note: string) => {
    if (!pendingStatus) return;
    setIsUpdating(true);
    try {
      await BugReportClientService.updateBugStatus(bug.id, pendingStatus, note);
      toast.success(`Bug status updated to ${bugStatusLabel(pendingStatus)}`);
      setPendingStatus(null);
      refetch();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update bug status'
      );
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/org/${organization.slug}/bugs`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground">Bug Report #{bug.id.substring(0, 8)}</p>
        </div>
        <div className="flex items-center gap-3">
          {refreshing && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <div className="flex flex-col items-end gap-2">
            <label className="text-sm font-medium text-muted-foreground">Status</label>
            <Select
              value={bug.status}
              onValueChange={setPendingStatus}
              disabled={isUpdating}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUG_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {BUG_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <BugStatusBadge status={bug.status} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Description</dt>
              <dd className="mt-1 text-sm">{bug.description}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Application</dt>
              <dd className="mt-1 text-sm font-medium">{bug.application?.name || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Category</dt>
              <dd className="mt-1 text-sm font-medium capitalize">{bug.category}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Page URL</dt>
              <dd className="mt-1">
                <a
                  href={bug.page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:underline flex items-center gap-1"
                >
                  {bug.page_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1 text-sm">
                {new Date(bug.created_at).toLocaleString()}
              </dd>
            </div>
            {bug.resolved_at && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Resolved</dt>
                <dd className="mt-1 text-sm">
                  {new Date(bug.resolved_at).toLocaleString()}
                </dd>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reporter Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reporterName && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Name</dt>
                <dd className="mt-1 text-sm">{reporterName}</dd>
              </div>
            )}
            {reporterEmail && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Email</dt>
                <dd className="mt-1 text-sm">{reporterEmail}</dd>
              </div>
            )}
            {!reporterName && !reporterEmail && (
              <p className="text-sm text-muted-foreground">Anonymous reporter</p>
            )}
            {bug.browser_info && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Browser</dt>
                <dd className="mt-1 text-xs text-muted-foreground line-clamp-2">{JSON.stringify(bug.browser_info)}</dd>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {bug.screenshot_url && (
        <Card>
          <CardHeader>
            <CardTitle>Screenshot</CardTitle>
          </CardHeader>
          <CardContent>
            <img
              src={bug.screenshot_url}
              alt="Bug screenshot"
              className="max-w-full rounded-lg border"
            />
          </CardContent>
        </Card>
      )}

      {/* File Attachments */}
      {bug.attachments && bug.attachments.length > 0 && (
        <AttachmentsSection attachments={bug.attachments} />
      )}

      {bug.console_logs && bug.console_logs.length > 0 && (
        <ConsoleLogsSection logs={bug.console_logs} />
      )}

      {/* Network Trace from SDK v1.2.0+ */}
      {bug.metadata?.network_trace && bug.metadata.network_trace.length > 0 && (
        <NetworkTraceSection networkTrace={bug.metadata.network_trace} />
      )}

      {/* AI-Powered Similar Bugs Detection */}
      <SimilarBugsCard bugId={id} organizationSlug={organization.slug} />

      {bug.messages && bug.messages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Messages</CardTitle>
            <CardDescription>{bug.messages.length} message(s)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {bug.messages.map((message) => (
                <div key={message.id} className="flex gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">
                        {message.user?.[0]?.email || 'Unknown'}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(message.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{message.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <StatusChangeDialog
        open={pendingStatus !== null}
        fromStatus={bug.status}
        toStatus={pendingStatus}
        submitting={isUpdating}
        onCancel={() => setPendingStatus(null)}
        onConfirm={handleStatusChange}
      />
    </div>
  );
}
