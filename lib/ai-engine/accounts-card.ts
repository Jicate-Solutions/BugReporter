/**
 * The "Claude accounts" card on AI Routines, worked out as plain data and plain
 * sentences. Pure (no database, no clock of its own), so every state the card
 * can show is tested in tests/accounts-card.test.ts.
 *
 * Why (Director, 20 Nov 2026): the card did not say which account is in use,
 * listed "default" as if it were an account, showed a key that fails as "not
 * used yet", and gave a box with no JICATE worker (Box 1) no line at all.
 *
 * What counts as "in use":
 *   - a whole box: what its box helper last reported (ai_boxes.applied_label),
 *     while the helper has been heard from in the last 3 minutes;
 *   - a worker: the account the Tower gives it at its next job (the box's
 *     choice, else the worker's own setting), while the worker is alive.
 * ai_runners.account_in_use is NOT used: it is only the account of the last
 * job a worker ran and stays put for hours after a switch.
 *
 * "default" means a box's own Windows sign-in. It is not an account, so it is
 * left out of the account list and named "own Windows sign-in" in every sentence.
 */

import { ago } from '@/lib/ai-engine/admin';
import { checkBlocksUse, readingStatus, type CheckKind, type CheckResult } from '@/lib/ai-engine/accounts';

/** The stored word for "the box's own Windows sign-in". */
export const OWN = 'default';

/** A box helper heard from within this long counts as there now (it reports every minute). */
const HELPER_ALIVE_MS = 180_000;
/** A worker heard from within this long counts as alive (same as runnerAlive). */
const WORKER_ALIVE_MS = 120_000;
/** The page keeps refreshing itself this long after a key was saved, while its check has no result yet. */
export const KEY_SETTLE_MS = 20 * 60_000;

/** What the Director calls each Windows computer. Any other computer shows under its own name. */
const BOX_NAMES: Record<string, string> = {
  biometric: 'Box 1',
  'desktop-1lb1fcs': 'Box 2'
};

export function boxName(host: string): string {
  return BOX_NAMES[host.toLowerCase()] ?? host;
}

/** India time, e.g. "Wed, 10:30 pm". */
export function istTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/** An account name as a sentence says it. */
function accountWords(label: string): string {
  return label === OWN ? 'its own Windows sign-in' : label;
}

export const OWN_SIGNIN_NOTE =
  'A box can also run on its own Windows sign-in (the Claude login on that computer) instead of an account from this list.';
export const OWN_SIGNIN_PRIORITY_NOTE = 'In "auto", the own sign-in takes its turn at this priority:';

export type BoxRow = {
  host: string;
  /** The choice made in the Tower: an account, 'auto', 'default' (own sign-in) or null (none). */
  account: string | null;
  /** What the Tower gives the box right now; null = its own sign-in. */
  chosen_label: string | null;
  /** What the box helper last reported; 'default' = its own sign-in; null = never reported. */
  applied_label: string | null;
  /** When the helper last reported it (on every switch, and with its file reports). */
  applied_at: string | null;
  agent_seen_at: string | null;
};

export type CardRunner = {
  name: string;
  host: string | null;
  /** The worker's own setting: an account, 'auto', or null (own sign-in). */
  account: string | null;
  last_seen_at: string;
};

export type BoxLine = {
  /** The computer name to send back to the Tower: the ai_boxes spelling when the box has a row. */
  host: string;
  /** "Box 1", or the computer name when it has no short name. */
  name: string;
  workers: string[];
  /** What the switch control shows: the box's choice, else the setting its workers share, else null (they differ, or nothing is chosen). */
  setting: string | null;
  helper: 'none' | 'alive' | 'silent';
  /** The account the whole box is on by its helper's last report ('default' = own sign-in); undefined = not reported. */
  on: string | undefined;
  /** Names of the alive workers, by the account the Tower gives them now ('default' = own sign-in). */
  aliveWorkersOn: Record<string, string[]>;
  sentence: string;
};

/** What the Tower gives everything on a box, or undefined when no choice is made for the box. */
function boxTarget(row: BoxRow | undefined): string | undefined {
  if (!row || row.account == null) return undefined;
  if (row.account === OWN) return OWN;
  if (row.account === 'auto') return row.chosen_label ?? OWN;
  return row.account;
}

/** True when a worker picks by its own "auto" setting: the page then asks the chooser what that gives. */
export function needsAutoPick(boxRows: BoxRow[], runners: CardRunner[]): boolean {
  const rows = new Map(boxRows.map((b) => [b.host.toLowerCase(), b]));
  return runners.some((r) => r.account === 'auto' && boxTarget(rows.get((r.host ?? '').toLowerCase())) === undefined);
}

const span = (iso: string, now: number) => ago(iso, now).replace(/ ago$/, '');

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const workersWord = (n: number) => `${n} ${n === 1 ? 'worker' : 'workers'}`;

/**
 * One line per Windows computer: every box in ai_boxes plus every computer a
 * worker runs on, matched without regard to capital letters. So a box with no
 * JICATE worker (Box 1 runs only MyJKKN's workers) still gets its line and its
 * switch control.
 * `autoPick` = what "auto" gives a worker right now, when the page asked.
 */
export function boxLines(boxRows: BoxRow[], runners: CardRunner[], now: number, autoPick?: string): BoxLine[] {
  const byHost = new Map<string, { host: string; row?: BoxRow; runners: CardRunner[] }>();
  for (const row of boxRows) byHost.set(row.host.toLowerCase(), { host: row.host, row, runners: [] });
  for (const r of runners) {
    const host = r.host ?? 'unknown box';
    const entry = byHost.get(host.toLowerCase()) ?? { host, runners: [] };
    entry.runners.push(r);
    byHost.set(host.toLowerCase(), entry);
  }

  return [...byHost.values()]
    .map(({ host, row, runners: rs }) => {
      const target = boxTarget(row);
      const seen = row?.agent_seen_at ? new Date(row.agent_seen_at).getTime() : null;
      const helper: BoxLine['helper'] = seen == null ? 'none' : now - seen < HELPER_ALIVE_MS ? 'alive' : 'silent';
      const on = helper === 'none' || row?.applied_label == null ? undefined : row.applied_label;

      // Each worker's account now; undefined when "auto" decides at each job and the pick is not known here.
      const workerOn = rs.map((r) => target ?? (r.account == null ? OWN : r.account === 'auto' ? autoPick : r.account));
      const aliveWorkersOn: Record<string, string[]> = {};
      rs.forEach((r, i) => {
        const mine = workerOn[i];
        if (mine !== undefined && now - new Date(r.last_seen_at).getTime() < WORKER_ALIVE_MS) {
          aliveWorkersOn[mine] = [...(aliveWorkersOn[mine] ?? []), r.name];
        }
      });
      const own = new Set(rs.map((r) => r.account ?? OWN));
      const setting = row?.account ?? (own.size === 1 ? [...own][0] : null);

      const switching = helper === 'alive' && target !== undefined && target !== on;
      const how = row?.account === 'auto' ? 'picked by "auto"' : 'chosen by hand';

      let sentence: string;
      if (helper === 'none') {
        const shared = new Set(workerOn);
        const theirs = shared.size === 1 ? [...shared][0] : undefined;
        sentence = !rs.length
          ? 'No box helper has checked in from this computer yet.'
          : 'The box helper is not installed on this computer yet, so only its JICATE workers follow the choice made here.' +
            (theirs === undefined ? '' : ` They are on ${theirs === OWN ? "the box's own Windows sign-in" : theirs}.`);
      } else if (helper === 'silent') {
        sentence =
          `Box helper not heard from for ${span(row!.agent_seen_at as string, now)}, so this may be out of date.` +
          (on === undefined ? '' : ` The box was last on ${accountWords(on)}.`);
      } else {
        const parts: string[] = [];
        if (on === undefined) {
          parts.push('The box has not said which account it is on yet.');
          if (target !== undefined) parts.push(`It should move to ${accountWords(target)} within a minute.`);
        } else if (switching) {
          parts.push(`On ${accountWords(on)} now.`);
          parts.push(`Switching to ${accountWords(target as string)} (${how}), usually within a minute.`);
        } else {
          parts.push(target === undefined ? `On ${accountWords(on)} now.` : `On ${accountWords(on)} now, ${how}.`);
          if (target === undefined) parts.push('No account has been chosen for this box here.');
          if (row?.applied_at) parts.push(`It has been on this for at least ${span(row.applied_at, now)}.`);
        }
        parts.push(`Box helper last seen ${ago(row!.agent_seen_at, now)}.`);
        parts.push('Claude tabs pick up a switch when reopened.');
        sentence = parts.join(' ');
      }

      return {
        host,
        name: boxName(host),
        workers: rs.map((r) => r.name),
        setting,
        helper,
        on,
        aliveWorkersOn,
        sentence
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who is on one account right now, as one sentence. A whole box is named with
 * a count of its workers; workers on an account their box is not on are named
 * one by one.
 */
export function usedBy(label: string, lines: BoxLine[]): { inUse: boolean; text: string } {
  const parts: string[] = [];
  for (const b of lines) {
    const whole = b.helper === 'alive' && b.on === label;
    const names = b.aliveWorkersOn[label] ?? [];
    if (whole) parts.push(names.length ? `${b.name} (${workersWord(names.length)})` : b.name);
    else if (names.length) parts.push(`${names.length === 1 ? 'worker' : 'workers'} ${names.join(', ')} on ${b.name}`);
  }
  return parts.length ? { inUse: true, text: `In use by ${list(parts)}` } : { inUse: false, text: 'Not in use now' };
}

export type AccountInput = {
  label: string;
  five_hour_util: number | null;
  seven_day_util: number | null;
  five_hour_resets_at: string | null;
  seven_day_resets_at: string | null;
  updated_at: string | null;
};

export type AccountView = {
  label: string;
  inUse: boolean;
  /** "In use by Box 1 and Box 2 (4 workers)" or "Not in use now". */
  usedBy: string;
  badges: { tone: 'green' | 'red' | 'amber'; text: string }[];
  /** The key's latest check in plain words. 'bad' is drawn in red. */
  status: { tone: 'ok' | 'bad' | 'wait' | 'plain'; text: string };
  /**
   * False when there is no reading, or the last check proved the account cannot
   * be used (an old reading must not look current). A check that was only slow
   * or failed for another reason says nothing about the account: its bars stay.
   */
  showBars: boolean;
};

/**
 * Short words for a failed check: the row's badge. Red only when the check
 * proved the account cannot be used; amber when the check itself went wrong.
 */
function failBadge(kind: CheckKind | undefined): AccountView['badges'][number] | null {
  if (kind === 'key-rejected') return { tone: 'red', text: 'Key rejected' };
  if (kind === 'blocked') return { tone: 'red', text: 'Blocked' };
  if (kind === 'too-slow' || kind === 'failed') return { tone: 'amber', text: 'Check failed' };
  return null;
}

/**
 * The account rows of the card: every account except "default" (a box's own
 * sign-in is not an account). `checks` holds an entry for each account whose
 * key is stored in the Tower; an account without one has no key here.
 */
export function accountViews(
  accounts: AccountInput[],
  checks: Map<string, CheckResult>,
  lines: BoxLine[],
  now: number
): AccountView[] {
  return accounts
    .filter((a) => a.label !== OWN)
    .map((a) => {
      const use = usedBy(a.label, lines);
      const check = checks.get(a.label);
      const reading = readingStatus(a, now);
      const full =
        reading.kind === 'full-until'
          ? `Full until ${istTime(reading.until)}. Checked again automatically right after it resets.`
          : null;
      const when = check?.at ? ago(check.at, now) : 'earlier';
      const hasReading = a.updated_at != null || a.five_hour_util != null || a.seven_day_util != null;

      let status: AccountView['status'];
      if (!check) {
        status = { tone: 'plain', text: 'No key saved in the Control Tower.' + (full ? ` ${full}` : '') };
      } else if (check.kind === 'key-rejected') {
        status = {
          tone: 'bad',
          text: `Key rejected: Claude does not accept this key. Add the account again below with the long key (it starts with sk-ant-oat01-). Checked ${when}.`
        };
      } else if (check.kind === 'blocked') {
        status = {
          tone: 'bad',
          text: `Blocked: this account's organisation has switched off Claude Code. Its admin must switch it back on, or remove this account. Checked ${when}.`
        };
      } else if (check.kind === 'too-slow') {
        status = { tone: 'plain', text: `Check failed: it took too long. It is checked again automatically. Last tried ${when}.` };
      } else if (check.kind === 'failed') {
        status = { tone: 'plain', text: `Check failed: Claude gave an error. It is checked again automatically. Last tried ${when}.` };
      } else if (check.kind === 'checking') {
        status = { tone: 'wait', text: 'Checking this key now. The result shows here in about a minute.' };
      } else if (check.kind === 'rechecking') {
        // A full account is skipped on purpose until it renews, so no check is promised.
        // Otherwise the watch round checks a key again 10 to 20 minutes after it was saved (labelsToProbe).
        status = full
          ? { tone: 'plain', text: full }
          : { tone: 'wait', text: 'Still checking this key. The result should show here within about 15 minutes.' };
      } else if (check.kind === 'unknown') {
        status = { tone: 'plain', text: 'Could not read the last check just now.' + (full ? ` ${full}` : '') };
      } else if (check.kind === 'not-checked') {
        // No time is promised: an account kept up to date by real jobs is not checked separately.
        status = full ? { tone: 'plain', text: full } : { tone: 'wait', text: 'No recent check of this key.' };
      } else if (full) {
        status = { tone: 'ok', text: `Key works. ${full}` };
      } else if (check.kind === 'no-allowance') {
        status = { tone: 'ok', text: `Key works, but the account had no allowance left when it was checked ${when}.` };
      } else {
        status = { tone: 'ok', text: `Key works. Checked ${when}.` };
      }

      const failed = failBadge(check?.kind);
      const badges: AccountView['badges'] = [];
      if (use.inUse) badges.push({ tone: 'green', text: 'In use' });
      if (failed) badges.push(failed);
      else if (full) badges.push({ tone: 'amber', text: 'Full' });

      return {
        label: a.label,
        inUse: use.inUse,
        usedBy: use.text,
        badges,
        status,
        showBars: hasReading && !(check && checkBlocksUse(check.kind))
      };
    });
}

/**
 * Should the page refresh itself for a while? Only while a key saved in the
 * last 20 minutes has no check result yet. Time-boxed, so a worker box that is
 * switched off never makes the page refresh for ever.
 */
export function cardIsSettling(
  keys: { label: string; added_at: string | null }[],
  checks: Map<string, CheckResult>,
  now: number
): boolean {
  const waiting: CheckKind[] = ['not-checked', 'checking', 'rechecking'];
  return keys.some((k) => {
    const kind = checks.get(k.label)?.kind;
    return (
      k.added_at != null &&
      now - new Date(k.added_at).getTime() < KEY_SETTLE_MS &&
      kind !== undefined &&
      waiting.includes(kind)
    );
  });
}
