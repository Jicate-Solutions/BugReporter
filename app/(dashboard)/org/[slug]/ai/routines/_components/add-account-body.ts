/**
 * Request body for the Control Tower "Add account" form. An empty (or
 * whitespace-only) Priority box sends no priority at all, so re-pasting a key
 * for an existing account keeps the priority it already has; a new account
 * gets none. Spaces and line breaks inside the pasted key are taken out (a
 * long key wraps onto two lines in the terminal).
 */
import { cleanAccountKey } from '@/lib/ai-engine/account-key-shape';

export type AddAccountBody = { label: string; key: string; priority?: number };

export function buildAddAccountBody(label: string, key: string, priorityText: string): AddAccountBody {
  const body: AddAccountBody = { label: label.trim(), key: cleanAccountKey(key) };
  if (priorityText.trim() !== '') body.priority = Number(priorityText);
  return body;
}
