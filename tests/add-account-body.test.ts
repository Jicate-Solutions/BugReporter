import { describe, it, expect } from 'vitest';
import { buildAddAccountBody } from '@/app/(dashboard)/org/[slug]/ai/routines/_components/add-account-body';

/**
 * Guards the form side of the aimech fix (2026-10-20): an empty Priority box
 * must leave `priority` out of the request body entirely (not send null), so
 * the accounts POST keeps the account's existing priority.
 */
describe('buildAddAccountBody', () => {
  it('leaves priority out when the Priority box is empty', () => {
    const body = buildAddAccountBody('aimech', 'k'.repeat(40), '');
    expect('priority' in body).toBe(false);
    expect(body).toEqual({ label: 'aimech', key: 'k'.repeat(40) });
  });

  it('leaves priority out when the Priority box is only whitespace', () => {
    const body = buildAddAccountBody(' aimech ', ' key ', '   ');
    expect('priority' in body).toBe(false);
    expect(body).toEqual({ label: 'aimech', key: 'key' });
  });

  it('sends the number when the Priority box has one', () => {
    expect(buildAddAccountBody('aimech', 'key', ' 3 ')).toEqual({ label: 'aimech', key: 'key', priority: 3 });
  });
});
