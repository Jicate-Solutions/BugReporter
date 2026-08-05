import type { Application } from '@boobalan_jkkn/shared';

type AppSettings = Application['settings'];

export interface BugPortalConfig {
  enabled: boolean;
  allowReporterNotes: boolean;
  /** Lets a reporter push a closed bug back open with a reason. */
  allowReporterReopen: boolean;
  requireSignature: boolean;
  webhookEnabled: boolean;
  webhookSecret: string | null;
}

/**
 * Resolve an application's Bug Status Portal configuration.
 *
 * Defaults matter here: `enabled` is false so no existing application changes
 * behaviour when this ships, while `allowReporterNotes` is true so that an app
 * which opts in gets the useful version of the feature without hunting for a
 * second switch. Every consumer reads through this function so the defaults
 * cannot drift between the portal, the API routes, and the settings UI.
 */
export function getBugPortalConfig(
  settings: AppSettings | null | undefined
): BugPortalConfig {
  const portal = settings?.bug_portal;

  const allowReporterNotes = portal?.allow_reporter_notes !== false;

  return {
    enabled: portal?.enabled === true,
    allowReporterNotes,
    // Defaults on, like allowReporterNotes: an app that has already opted into
    // the portal wants the useful version of it, not a second switch to hunt
    // for. Teams that would rather own the status outright can turn it off.
    //
    // Gated on notes because a reopen carries a required written reason that is
    // posted to the thread. With notes off there is nowhere for that reason to
    // go, so the reopen would move the status and silently discard the only part
    // the team needs. Derived here rather than checked at each call site so the
    // settings UI and the API cannot disagree about it.
    allowReporterReopen:
      allowReporterNotes && portal?.allow_reporter_reopen !== false,
    requireSignature: portal?.require_signature === true,
    webhookEnabled: portal?.webhook_enabled === true,
    webhookSecret: portal?.webhook_secret ?? null,
  };
}

/** Normalises a reporter email for comparison against bug_reports.reporter_email. */
export function normalizeReporterEmail(
  email: string | null | undefined
): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
