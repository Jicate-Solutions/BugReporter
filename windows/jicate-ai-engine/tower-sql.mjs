// SQL against the Control Tower database through the Supabase Management API
// (runs on the Mac, never on a box). Used by box-command.mjs and
// sign-box-file.mjs --publish. Pure ASCII on purpose.
//
// Values never get spliced into SQL as text: a row travels as hex-encoded
// UTF-8 JSON and is turned back into a typed record by Postgres
// (jsonb_populate_record), so nothing in it needs escaping. Hex is [0-9a-f]
// only, so it cannot end a string literal.
//
// The token is read from ~/.supabase/access-token, used only in the
// Authorization header and never printed.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const PROJECT_REF = 'adakhqxgaoxaihtehfqw';

/** A SQL expression that evaluates to `obj` as jsonb. */
export function jsonbLiteral(obj) {
  const hex = Buffer.from(JSON.stringify(obj), 'utf8').toString('hex');
  return `convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb`;
}

function readToken(tokenPath) {
  let token;
  try {
    token = readFileSync(tokenPath, 'utf8').trim();
  } catch {
    throw new Error(`cannot read the Supabase access token at ${tokenPath}`);
  }
  if (!token) throw new Error(`the Supabase access token at ${tokenPath} is empty`);
  return token;
}

/** Run one statement; returns the rows. readOnly=true for SELECTs. */
export async function runSql(query, { readOnly = false, tokenPath = resolve(homedir(), '.supabase', 'access-token') } = {}) {
  const token = readToken(tokenPath);
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Management API answered with something that is not JSON: ${text.slice(0, 200)}`);
  }
}
