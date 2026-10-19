'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ANNOTATION_TOOLS,
  ANNOTATION_TOOL_HINTS,
  ANNOTATION_TOOL_LABELS,
  type AnnotationTool,
  type Application,
} from '@boobalan_jkkn/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ApplicationClientService } from '@/lib/services/applications/client';
import { getAnnotationConfig } from '@/lib/services/annotation/config';
import { getBugPortalConfig } from '@/lib/services/bug-portal/config';
import { SettingsToggleRow } from './settings-toggle-row';

interface AnnotationCardProps {
  application: Application;
  onSaved?: () => void;
}

/**
 * The opt-in surface for screenshot annotation.
 *
 * Off by default, so an application that never opens this card behaves exactly
 * as it did before the feature existed. Turning it on affects two places at once
 * — the capture widget's toolbar and the reporter portal — because both read
 * this one switch, the widget through /api/v1/public/config.
 */
export function AnnotationCard({ application, onSaved }: AnnotationCardProps) {
  const initial = getAnnotationConfig(application.settings);
  const portal = getBugPortalConfig(application.settings);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [tools, setTools] = useState<AnnotationTool[]>(initial.tools);
  const [saving, setSaving] = useState(false);

  const toggleTool = (tool: AnnotationTool, on: boolean) =>
    setTools((current) =>
      on
        ? ANNOTATION_TOOLS.filter((t) => t === tool || current.includes(t))
        : current.filter((t) => t !== tool)
    );

  const handleSave = async () => {
    if (enabled && tools.length === 0) {
      toast.error('Leave at least one tool on, or switch annotation off.');
      return;
    }

    setSaving(true);
    try {
      // Merge, never replace. `settings` is a single JSONB column, so writing a
      // bare { annotation } would wipe allowed_domains, the AI config, and the
      // whole Bug Status Portal setup alongside it.
      const nextSettings: Application['settings'] = {
        ...(application.settings || {}),
        annotation: {
          enabled,
          tools,
        },
      };

      await ApplicationClientService.updateApplication({
        id: application.id,
        settings: nextSettings,
      });

      toast.success(
        enabled ? 'Screenshot annotation enabled' : 'Screenshot annotation disabled'
      );
      onSaved?.();
    } catch (error) {
      console.error('[AnnotationCard] Save failed:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to save settings'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Screenshot annotation</CardTitle>
            <CardDescription>
              Let the people reporting bugs in {application.name} draw on the
              screenshot — box the element, label what should change, cover
              anything private — instead of describing it in prose.
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable screenshot annotation"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            Off. Screenshots arrive exactly as captured, and the annotation
            endpoint is closed for this application.
          </p>
        ) : (
          <>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Marks are flattened into the image before it is stored — there is
                no separate layer for your team to switch off, and the file in
                the dashboard is the one the reporter drew on.
              </p>
              {portal.enabled ? (
                portal.allowReporterNotes ? (
                  <p>
                    Reporters can also mark up a screenshot after the fact, from
                    the Bug Status Portal. It arrives as a note on the thread.
                  </p>
                ) : (
                  <p>
                    Annotating from the Bug Status Portal needs{' '}
                    <span className="font-medium">Let reporters reply</span>{' '}
                    turned on above — the marked-up image is posted to the
                    thread, so with replies off there is nowhere for it to land.
                    The capture widget is unaffected.
                  </p>
                )
              ) : (
                <p>
                  This applies to the capture widget. Turn on the Bug Status
                  Portal above to also let reporters mark up a screenshot after
                  they have sent it.
                </p>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              {ANNOTATION_TOOLS.map((tool) => (
                <SettingsToggleRow
                  key={tool}
                  id={`annotation-tool-${tool}`}
                  label={ANNOTATION_TOOL_LABELS[tool]}
                  description={
                    tool === 'redact'
                      ? `${ANNOTATION_TOOL_HINTS[tool]}. Draws an opaque block, not a blur — what is underneath is gone.`
                      : ANNOTATION_TOOL_HINTS[tool]
                  }
                  checked={tools.includes(tool)}
                  onChange={(on) => toggleTool(tool, on)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save annotation settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
