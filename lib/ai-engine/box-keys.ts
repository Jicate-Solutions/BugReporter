/**
 * Box keys — secrets the Director pastes in the Control Tower once, which the
 * box agent on ONE Windows box writes into ONE env file as ONE variable
 * (Director, 2026-10-26: "Why not ok ui of jicate control tower").
 *
 * The allow-list lives here, in code, on purpose: the page offers only these
 * targets, the save route accepts only their ids, and the box-agent route hands
 * out only rows whose target is still listed here. Nobody can aim a key at an
 * arbitrary file or variable by writing a database row. The box agent keeps its
 * own copy of this list (jicate-box-agent.mjs BOX_KEY_TARGETS) and refuses
 * anything else; keep the two in step.
 *
 * Sealing reuses the Claude account-key scheme (AES-256-GCM with
 * AI_ACCOUNT_KEY_SECRET, lib/ai-engine/account-keys.ts). Server-side only.
 * Never log a value.
 */

import { openAccountKey, sealAccountKey } from './account-keys';

export interface BoxKeyTarget {
  /** Stable id, stored in ai_box_keys.target_id and logged as the fetch label. */
  id: string;
  /** ai_boxes.host, as the box reports it. */
  host: string;
  /** Full Windows path of the env file on that box. */
  file: string;
  /** Variable name written as NAME=value. */
  name: string;
  /** Plain-English line for the page. */
  description: string;
}

export const BOX_KEY_TARGETS: readonly BoxKeyTarget[] = [
  {
    id: 'build-worker-github-token',
    host: 'DESKTOP-1LB1FCS',
    file: 'C:\\jicate-ai\\build-worker\\build-worker.env',
    name: 'BUILD_GITHUB_TOKEN',
    description: 'GitHub token the Box 2 build worker uses to push branches and open pull requests.'
  }
];

/** The target with this id, or null. */
export function findBoxKeyTarget(id: unknown): BoxKeyTarget | null {
  if (typeof id !== 'string') return null;
  return BOX_KEY_TARGETS.find((t) => t.id === id) ?? null;
}

/** The target with this id on this host (host compared in any letter case), or null. */
export function resolveBoxKeyTarget(host: string, id: unknown): BoxKeyTarget | null {
  const t = findBoxKeyTarget(id);
  if (!t || t.host.toLowerCase() !== String(host).toLowerCase()) return null;
  return t;
}

/**
 * A value that can sit on one env-file line as NAME=value with no quoting:
 * visible ASCII only, no spaces, quotes, backslash, #, $ or backtick.
 * Tokens such as ghp_… and github_pat_… pass.
 */
export const BOX_KEY_VALUE = /^[!%&()*+,\-./0-9:;<=>?@A-Z[\]^_a-z{|}~]{8,1000}$/;

export function boxKeyValueOk(value: unknown): value is string {
  return typeof value === 'string' && BOX_KEY_VALUE.test(value);
}

export const sealBoxKey = (plain: string) => sealAccountKey(plain);
export const openBoxKey = (sealed: string) => openAccountKey(sealed);
