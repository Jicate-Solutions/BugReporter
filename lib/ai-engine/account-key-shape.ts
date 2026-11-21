/**
 * What a Claude account key looks like, for the "Add a Claude account" form
 * and its route (both use this file, so they agree).
 *
 * Why (20 Nov 2026): three accounts were saved with a value that was not a key
 * at all. The form took any 20 characters and said "saved"; every check then
 * failed where nobody could see it.
 *
 * The key is the long line `claude setup-token` prints in the terminal when it
 * finishes. It starts with sk-ant-oat01- and holds only letters, digits, "_"
 * and "-". The three keys that work are 108 characters long; the floor of 100
 * is an estimate from those three, low enough for a slightly shorter key and
 * high enough to catch one cut off where the terminal wrapped the line.
 *
 * No imports: a client component loads this file. A message never contains
 * the pasted value.
 */

export const ACCOUNT_KEY_PREFIX = 'sk-ant-oat01-';
export const ACCOUNT_KEY_MIN = 100;
export const ACCOUNT_KEY_MAX = 500;

/** The pasted text with every space and line break taken out (a long key wraps onto two lines). */
export function cleanAccountKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** null when the key looks right; otherwise one plain sentence saying what to paste instead. */
export function accountKeyProblem(raw: string): string | null {
  const key = cleanAccountKey(raw);
  if (!key) return 'Paste the key first.';
  if (!key.startsWith(ACCOUNT_KEY_PREFIX)) {
    return (
      'That is not the long key. Paste the long key the terminal prints when claude setup-token finishes. ' +
      `It starts with ${ACCOUNT_KEY_PREFIX}. The short code the browser shows is not the key.`
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    return 'The key has extra characters in it. Copy only the key, nothing before or after it.';
  }
  if (key.length < ACCOUNT_KEY_MIN) {
    return 'Part of the key is missing. It can run onto a second line in the terminal. Copy the whole key, both lines.';
  }
  if (key.length > ACCOUNT_KEY_MAX) {
    return 'That is too long to be one key. Copy only the key, nothing before or after it.';
  }
  return null;
}
