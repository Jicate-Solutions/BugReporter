'use client';

import { useCallback, useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { Check, Copy, ExternalLink, Loader2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { createClient } from '@/lib/supabase/client';
import { ApplicationClientService } from '@/lib/services/applications/client';
import { getBugPortalConfig } from '@/lib/services/bug-portal/config';
import type { Application } from '@boobalan_jkkn/shared';

interface BugPortalCardProps {
  application: Application;
  onSaved?: () => void;
}

interface DeliveryRow {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
}

/**
 * The opt-in surface for the Bug Status Portal.
 *
 * Everything here is per-application and off by default, so an application that
 * never opens this card behaves exactly as it did before the feature existed.
 * Turning the master switch on generates a webhook secret and produces a ready
 * -to-paste link — that link is the entire integration step for the app.
 */
export function BugPortalCard({ application, onSaved }: BugPortalCardProps) {
  const initial = getBugPortalConfig(application.settings);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [allowNotes, setAllowNotes] = useState(initial.allowReporterNotes);
  const [allowReopen, setAllowReopen] = useState(initial.allowReporterReopen);
  const [requireSignature, setRequireSignature] = useState(
    initial.requireSignature
  );
  const [webhookEnabled, setWebhookEnabled] = useState(initial.webhookEnabled);
  const [webhookUrl, setWebhookUrl] = useState(
    application.settings?.webhook_url || ''
  );
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const portalUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/portal/${application.slug}`
      : `/portal/${application.slug}`;

  const snippet = `<a href="${portalUrl}?u=\${encodeURIComponent(user.email)}">
  My bug reports
</a>`;

  const loadDeliveries = useCallback(async () => {
    if (!initial.webhookEnabled) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('webhook_deliveries')
      .select('id, event_type, status, attempts, response_status, last_error, created_at')
      .eq('application_id', application.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setDeliveries((data as DeliveryRow[]) || []);
  }, [application.id, initial.webhookEnabled]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const handleSave = async () => {
    if (webhookEnabled && !webhookUrl.trim()) {
      toast.error('Add a webhook URL, or switch webhooks off.');
      return;
    }

    setSaving(true);
    try {
      // Merge, never replace. `settings` is a single JSONB column, so writing a
      // bare { bug_portal } would wipe allowed_domains, the AI config, and
      // everything else stored alongside it.
      const nextSettings: Application['settings'] = {
        ...(application.settings || {}),
        webhook_url: webhookUrl.trim(),
        bug_portal: {
          enabled,
          allow_reporter_notes: allowNotes,
          allow_reporter_reopen: allowReopen,
          require_signature: requireSignature,
          webhook_enabled: webhookEnabled,
          webhook_secret:
            application.settings?.bug_portal?.webhook_secret ||
            (enabled ? `whsec_${nanoid(32)}` : undefined),
        },
      };

      await ApplicationClientService.updateApplication({
        id: application.id,
        settings: nextSettings,
      });

      toast.success(
        enabled ? 'Bug Status Portal enabled' : 'Bug Status Portal disabled'
      );
      onSaved?.();
    } catch (error) {
      console.error('[BugPortalCard] Save failed:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to save settings'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${portalUrl}?u=`);
      setCopied(true);
      toast.success('Portal link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Bug Status Portal</CardTitle>
            <CardDescription>
              Let the people who report bugs in {application.name} track what
              happened to them, and exchange notes with your team.
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable Bug Status Portal"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!enabled && (
          <p className="text-sm text-muted-foreground">
            Off. Reporters cannot see their bug status, and the notes API is
            closed for this application.
          </p>
        )}

        {enabled && (
          <>
            <div className="space-y-2">
              <Label>Link to add to {application.name}</Label>
              <div className="flex gap-2">
                <Input
                  value={`${portalUrl}?u=<user email>`}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  title="Copy portal link"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button type="button" variant="outline" size="icon" asChild>
                  <a href={portalUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
                {snippet}
              </pre>
              <p className="text-xs text-muted-foreground">
                Pass the signed-in user&apos;s email — the same value your SDK
                already receives as <code>userContext.email</code>. Each reporter
                sees only their own bugs.
              </p>
            </div>

            {!requireSignature && (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  The email in that link comes from the browser, so a determined
                  user of {application.name} could edit it and read another
                  user&apos;s bug reports for this application. Fine for internal
                  tools. To close it, have your backend sign the link and turn on
                  &ldquo;Require signed links&rdquo; below.
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="space-y-4">
              <ToggleRow
                id="allow-notes"
                label="Let reporters reply"
                description="Reporters can post notes on their own bugs. Turn off to make the portal read-only."
                checked={allowNotes}
                onChange={setAllowNotes}
              />
              <ToggleRow
                id="allow-reopen"
                label="Let reporters say it's still broken"
                description="A reporter can push a bug you closed back to Seen, with a required reason. You get an email; the original resolved date is kept. Turn off to own the status outright."
                checked={allowReopen}
                onChange={setAllowReopen}
                disabled={!allowNotes}
                disabledHint="Needs replies turned on — a reopen carries a written reason."
              />
              <ToggleRow
                id="require-signature"
                label="Require signed links"
                description="Reject portal links without a valid HMAC signature. Only turn on once your app mints signed links, or the portal will stop opening."
                checked={requireSignature}
                onChange={setRequireSignature}
              />
              <ToggleRow
                id="webhook-enabled"
                label="Send webhooks"
                description="POST to your endpoint whenever a status changes or a note is added."
                checked={webhookEnabled}
                onChange={setWebhookEnabled}
              />
            </div>

            {webhookEnabled && (
              <div className="space-y-2">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input
                  id="webhook-url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-app.com/api/bug-webhook"
                />
                <p className="text-xs text-muted-foreground">
                  Requests are signed with{' '}
                  <code>X-BugReporter-Signature</code> (HMAC-SHA256) using this
                  application&apos;s webhook secret.
                </p>

                {deliveries.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium">Recent deliveries</p>
                    {deliveries.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-mono">{d.event_type}</span>
                        <div className="flex items-center gap-2">
                          {d.last_error && (
                            <span
                              className="max-w-[220px] truncate text-destructive"
                              title={d.last_error}
                            >
                              {d.last_error}
                            </span>
                          )}
                          <Badge
                            variant={
                              d.status === 'done' ? 'secondary' : 'outline'
                            }
                          >
                            {d.status}
                            {d.response_status ? ` ${d.response_status}` : ''}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save portal settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  disabledHint,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">
          {disabled && disabledHint ? disabledHint : description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked && !disabled}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
