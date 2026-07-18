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
}

export const ROUTINE_CATALOG: RoutineCatalogEntry[] = [
  {
    id: 'app.brief',
    name: 'Scheduled briefing',
    whatItDoes:
      "A plain-English read of the app's bugs — where things stand, what to fix first, and what to watch out for.",
    defaultDaysOfWeek: [1, 2, 3, 4, 5],
    defaultMinuteOfDay: 210 // 03:30 UTC ≈ 09:00 IST
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
