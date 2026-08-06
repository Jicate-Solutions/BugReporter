import {
  ANNOTATION_TOOLS,
  isAnnotationTool,
  type AnnotationTool,
  type Application,
} from '@boobalan_jkkn/shared';
import { getBugPortalConfig } from '@/lib/services/bug-portal/config';

type AppSettings = Application['settings'];

export interface AnnotationConfig {
  enabled: boolean;
  tools: AnnotationTool[];
}

/**
 * Resolve an application's screenshot-annotation configuration.
 *
 * Every consumer reads through this function — the settings card, the portal
 * page, the portal write route, and the public config endpoint the capture
 * widget calls — so the defaults cannot drift between the four places that would
 * otherwise each decide what an absent key means.
 *
 * `enabled` is opt-in (`=== true`), unlike `allow_reporter_notes` which defaults
 * on. The argument for defaulting on is real — an app that opted into the portal
 * wants the useful version of it, not a second switch to hunt for — but it does
 * not carry here. Turning this on opens a path for reporter-supplied image data
 * into a PUBLIC storage bucket, and an application that enabled the portal months
 * ago must not acquire an upload endpoint by upgrading.
 */
export function getAnnotationConfig(
  settings: AppSettings | null | undefined
): AnnotationConfig {
  const annotation = settings?.annotation;

  // Intersected with the known tools rather than trusted. This is free-form
  // JSONB: a value written by an older build, or by hand, must not be able to
  // put an unrenderable tool in a toolbar.
  const stored = Array.isArray(annotation?.tools)
    ? annotation.tools.filter(isAnnotationTool)
    : null;

  return {
    enabled: annotation?.enabled === true,
    tools: stored && stored.length > 0 ? stored : [...ANNOTATION_TOOLS],
  };
}

/**
 * Whether a reporter may annotate from the Bug Status Portal.
 *
 * Gated on `allowReporterNotes` as well as on the feature itself, for the same
 * reason reopen and status are: the annotated image is posted to the thread as a
 * reporter message. With replies turned off there is nowhere for it to land, so
 * the button would upload a file and then have nothing to attach it to.
 *
 * Derived here rather than checked at each call site so the portal page and the
 * portal route cannot disagree about it.
 */
export function canAnnotateFromPortal(
  settings: AppSettings | null | undefined
): boolean {
  return (
    getAnnotationConfig(settings).enabled &&
    getBugPortalConfig(settings).allowReporterNotes
  );
}
