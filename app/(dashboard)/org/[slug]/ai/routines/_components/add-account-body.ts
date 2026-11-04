/**
 * Request body for the Control Tower "Add account" form. An empty (or
 * whitespace-only) Priority box sends no priority at all, so re-pasting a key
 * for an existing account keeps the priority it already has; a new account
 * gets none. A key never contains spaces or line breaks, so all of them are
 * removed: a key copied from a wrapped terminal line arrives whole (2026-11-04,
 * ainursing failed "Not logged in" on every job after such a paste).
 */
export type AddAccountBody = { label: string; key: string; priority?: number };

export function buildAddAccountBody(label: string, key: string, priorityText: string): AddAccountBody {
  const body: AddAccountBody = { label: label.trim(), key: key.replace(/\s+/g, '') };
  if (priorityText.trim() !== '') body.priority = Number(priorityText);
  return body;
}
