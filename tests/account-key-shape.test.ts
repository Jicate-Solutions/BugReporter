import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_KEY_MIN,
  ACCOUNT_KEY_PREFIX,
  accountKeyProblem,
  cleanAccountKey
} from '@/lib/ai-engine/account-key-shape';

/**
 * The "Add a Claude account" form and its route refuse a value that is not a
 * setup-token key (20 Nov 2026: three accounts were saved with a 92-character
 * value that was not a key; the form took any 20 characters and said "saved").
 * Keys here are built from the prefix plus filler, never a real-looking literal.
 */

const GOOD = ACCOUNT_KEY_PREFIX + 'A'.repeat(95); // 108 characters, like the keys that work

describe('cleanAccountKey', () => {
  it('takes out spaces and line breaks (a long key wraps onto two lines)', () => {
    const wrapped = `  ${GOOD.slice(0, 60)}\n   ${GOOD.slice(60)}\r\n`;
    expect(cleanAccountKey(wrapped)).toBe(GOOD);
  });
});

describe('accountKeyProblem', () => {
  it('accepts a well-formed key, also when pasted wrapped', () => {
    expect(accountKeyProblem(GOOD)).toBeNull();
    expect(accountKeyProblem(`${GOOD.slice(0, 60)}\n${GOOD.slice(60)}`)).toBeNull();
  });

  it('refuses a 92-character value that is not a key (what was saved on 20 Nov)', () => {
    const notAKey = 'Z'.repeat(92);
    const problem = accountKeyProblem(notAKey);
    expect(problem).toContain('not the long key');
    expect(problem).toContain(ACCOUNT_KEY_PREFIX);
  });

  it('refuses another kind of Anthropic key', () => {
    expect(accountKeyProblem('sk-ant-api03-' + 'A'.repeat(95))).toContain('not the long key');
  });

  it('refuses a key cut off where the terminal wrapped the line', () => {
    const cut = GOOD.slice(0, ACCOUNT_KEY_MIN - 1);
    expect(accountKeyProblem(cut)).toContain('Part of the key is missing');
  });

  it('refuses a key with something extra copied along', () => {
    expect(accountKeyProblem(`${GOOD}"`)).toContain('extra characters');
    expect(accountKeyProblem(ACCOUNT_KEY_PREFIX + 'A'.repeat(600))).toContain('too long');
  });

  it('asks for a key when nothing was pasted', () => {
    expect(accountKeyProblem('   ')).toBe('Paste the key first.');
  });

  it('never repeats the pasted value in its message', () => {
    const secretish = 'Q7'.repeat(46);
    for (const paste of [secretish, ACCOUNT_KEY_PREFIX + secretish.slice(0, 40), `${ACCOUNT_KEY_PREFIX}${secretish}!`]) {
      expect(accountKeyProblem(paste)).not.toContain(secretish.slice(0, 12));
    }
  });
});
