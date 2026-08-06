'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * One switch in an application settings card.
 *
 * A dependent switch is dimmed rather than hidden, and its description is
 * replaced by the reason it cannot be used — hiding it would leave the app's
 * developer looking for a setting the docs told them exists, and greying it
 * without saying why is barely better.
 */
export function SettingsToggleRow({
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
