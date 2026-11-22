/**
 * India time for the "Claude accounts" card, written out by hand.
 *
 * India has one time zone and no summer time: it is always 5 hours 30 minutes
 * ahead of UTC. So a moment is shifted by 330 minutes and read with the UTC
 * getters. Nothing here depends on the server's own time zone or on how a
 * given Node version spells a date.
 *
 * No imports: a client component loads this file too.
 */

const IST_OFFSET_MS = 330 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const two = (n: number) => String(n).padStart(2, '0');

/** Today's date in India as "YYYY-MM-DD". Just after midnight in India this is already the next day, while UTC is still on the old one. */
export function istToday(now: number): string {
  const d = new Date(now + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** A moment in India time: "Sun 22 Nov, 2 pm" or "Wed 25 Nov, 5:30 pm". */
export function istDateTime(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const clock = `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? '' : `:${two(m)}`} ${h < 12 ? 'am' : 'pm'}`;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${clock}`;
}

/** A moment moved to the nearest full hour on an Indian clock (a UTC full hour is a half hour in India). */
export function nearestIstHour(ms: number): number {
  const hour = 3_600_000;
  return Math.round((ms + IST_OFFSET_MS) / hour) * hour - IST_OFFSET_MS;
}

/** The three numbers of a "YYYY-MM-DD" date, or null when it is not one. Never goes through a clock. */
export function dateParts(date: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}

/** How many days month `m` (1 to 12) of year `y` has. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A calendar date in words: "5 Dec", or "5 Dec 2027" with the year. */
export function dayMonth(date: string, withYear = false): string {
  const p = dateParts(date);
  if (!p) return date;
  return `${p.d} ${MONTHS[p.m - 1]}${withYear ? ` ${p.y}` : ''}`;
}

/** Whole days from one "YYYY-MM-DD" date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = dateParts(from);
  const b = dateParts(to);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}
