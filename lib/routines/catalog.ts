/**
 * Client-safe routine catalog — pure metadata shared by the UI (client) and the
 * server registry. The server registry (registry.ts) attaches each kind's
 * buildInput (which has server-only deps); this file carries only what a browser
 * needs to render + schedule a routine. Keep the two in sync via this one source.
 */

export interface RoutineCatalogEntry {
  id: string;
  name: string;
  whatItDoes: string;
  defaultDaysOfWeek: number[];
  defaultMinuteOfDay: number;
  /**
   * True for kinds computed by the target app itself over HTTPS (the answer comes
   * back in the same request — no AI-engine job to poll). The client uses this to
   * pick a longer run-now deadline; the server registry carries the real executor.
   */
  direct?: true;
}

export const ROUTINE_CATALOG: RoutineCatalogEntry[] = [
  {
    id: 'app.brief',
    name: 'Scheduled briefing',
    whatItDoes:
      "A plain-English read of the app's bugs — where things stand, what to fix first, and what to watch out for.",
    defaultDaysOfWeek: [1, 2, 3, 4, 5],
    defaultMinuteOfDay: 210 // 03:30 UTC ≈ 09:00 IST
  },
  // ── BuildWise lane — the app computes, the console keeps the receipt ─────────
  // These call BuildWise's own /api/jobs/* endpoints over HTTPS and file the
  // returned summary here.
  //
  // NOT side-effect-free: cash-digest, budget-watchdog and anomaly-scan write
  // alert rows in BuildWise, and a new HIGH-severity row pushes a notification to
  // the managing director's phone. Only reconcile is silent. Scheduling one of the
  // first three schedules a message to a human — keep the copy below honest.
  //
  // BuildWise has a fifth job, push-flush, deliberately NOT listed here: it is the
  // delivery path (it releases queued notifications), not a read. Adding it would
  // turn this lane from "ask for a summary" into "make the platform send", which is
  // a different safety review. Leave it out.
  {
    id: 'buildwise.cash-digest',
    name: 'BuildWise: daily cash digest',
    whatItDoes:
      "Asks BuildWise for the day's cash picture — money in, money out, where balances stand — and files the summary here. A high-severity finding also pushes a notification to the managing director's phone.",
    defaultDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    defaultMinuteOfDay: 890, // 14:50 UTC ≈ 20:20 IST
    direct: true
  },
  {
    id: 'buildwise.budget-watchdog',
    name: 'BuildWise: budget watchdog',
    whatItDoes:
      "Has BuildWise compare spend against each project budget and raise alerts for lines running hot. A high-severity alert also pushes a notification to the managing director's phone.",
    defaultDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    defaultMinuteOfDay: 905, // 15:05 UTC ≈ 20:35 IST
    direct: true
  },
  {
    id: 'buildwise.anomaly-scan',
    name: 'BuildWise: anomaly scan',
    whatItDoes:
      "Weekly sweep where BuildWise looks for transactions that break its usual patterns and raises flags for review. A high-severity flag also pushes a notification to the managing director's phone. Summary lands here.",
    defaultDaysOfWeek: [0], // Sundays (0=Sun, matching Postgres DOW)
    defaultMinuteOfDay: 920, // 15:20 UTC ≈ 20:50 IST
    direct: true
  },
  {
    id: 'buildwise.reconcile',
    name: 'BuildWise: weekly reconcile',
    whatItDoes:
      'Weekly reconciliation pass — BuildWise checks its books line up (Tally vs recorded transactions) and reports what matched and what needs a look.',
    defaultDaysOfWeek: [0], // Sundays
    defaultMinuteOfDay: 935, // 15:35 UTC ≈ 21:05 IST
    direct: true
  }
];

export const getCatalogEntry = (id: string): RoutineCatalogEntry | undefined =>
  ROUTINE_CATALOG.find((e) => e.id === id);

/** 0=Sun .. 6=Sat — short labels for the schedule editor. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** minute-of-day (UTC) → "HH:MM" display. */
export function minuteToHHMM(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" → minute-of-day (UTC). Returns null when malformed. */
export function hhmmToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const minute = h * 60 + m;
  // The daily grid tops out at the last */15 tick (23:45 = 1425); a later time can't
  // fire before UTC-midnight. Reject it so the editor surfaces an error, rather than
  // silently clamping 23:50→23:45 (which left the Save button stuck showing "23:50").
  if (minute > 1425) return null;
  return minute;
}
