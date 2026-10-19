/**
 * Encryption for Claude account keys kept in the Control Tower
 * (ai_account_secrets). AES-256-GCM with the master key AI_ACCOUNT_KEY_SECRET
 * (32 random bytes, base64), which lives only in the server's settings.
 * Server-side only. Never log a key or a decrypted value.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function master(): Buffer {
  const raw = process.env.AI_ACCOUNT_KEY_SECRET ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('AI_ACCOUNT_KEY_SECRET is missing or not 32 bytes');
  return key;
}

/** "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function sealAccountKey(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function openAccountKey(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unknown key format');
  const d = createDecipheriv('aes-256-gcm', master(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
