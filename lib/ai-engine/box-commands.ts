/**
 * Remote-control commands for a Windows box (ai_box_commands). Pure logic, so
 * the route and the tests share one definition.
 *
 * A command row carries `payload` (the exact signed bytes: UTF-8 JSON
 * {id, box, verb, args, expires_at}, keys in that order) and `signature`
 * (base64 Ed25519 over those bytes, made on the Mac with the same key as
 * ai_box_files). The box agent trusts only the payload; the other columns are
 * an index for the Tower. Keep VERBS in step with the CHECK in
 * 20261024_box_remote_control.sql and with box-command.mjs.
 */
import { z } from 'zod';

export const COMMAND_VERBS = ['status', 'restart-task', 'register-task', 'run-script'] as const;
export type CommandVerb = (typeof COMMAND_VERBS)[number];

export const COMMAND_STATUSES = ['queued', 'running', 'done', 'failed', 'refused', 'expired'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/** States the agent may report. `expired` is set only by the Tower. */
export const AGENT_STATUSES = ['running', 'done', 'failed', 'refused'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TERMINAL_STATUSES: readonly CommandStatus[] = ['done', 'failed', 'refused', 'expired'];

/** Most commands handed to a box per poll. */
export const MAX_COMMANDS_PER_POLL = 5;
/** Longest a command may stay valid (also a CHECK on the table). */
export const MAX_EXPIRY_MS = 6 * 60 * 60 * 1000;
/** Largest `result` or `status_report` accepted, as serialized JSON. */
export const MAX_REPORT_BYTES = 128 * 1024;

export const SIGNATURE_B64 = /^[A-Za-z0-9+/]{86}==$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isVerb(v: unknown): v is CommandVerb {
  return typeof v === 'string' && (COMMAND_VERBS as readonly string[]).includes(v);
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Which current states a reported status may move a row from, and which
 * timestamp it sets. A terminal row never moves: the update is guarded in the
 * database with `status IN (from)`, so it is atomic.
 */
export function transition(
  status: AgentStatus,
  nowIso: string
): { from: CommandStatus[]; set: { started_at: string } | { finished_at: string } } {
  if (status === 'running') return { from: ['queued'], set: { started_at: nowIso } };
  return { from: ['queued', 'running'], set: { finished_at: nowIso } };
}

/** The exact bytes that get signed. Key order matters; do not reorder. */
export function canonicalPayload(c: {
  id: string;
  box: string;
  verb: string;
  args: Record<string, unknown>;
  expires_at: string;
}): string {
  return JSON.stringify({ id: c.id, box: c.box, verb: c.verb, args: c.args, expires_at: c.expires_at });
}

export type CommandRow = {
  id: string;
  verb: string;
  payload: string;
  signature: string;
  status: string;
  expires_at: string;
  created_at: string;
};

/** What a box receives: queued, not expired, well formed, oldest first, at most 5. */
export function selectQueued(rows: CommandRow[], now: Date) {
  const t = now.getTime();
  return rows
    .filter(
      (r) =>
        r.status === 'queued' &&
        Date.parse(r.expires_at) > t &&
        UUID.test(r.id) &&
        isVerb(r.verb) &&
        typeof r.payload === 'string' &&
        SIGNATURE_B64.test(r.signature)
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, MAX_COMMANDS_PER_POLL)
    .map((r) => ({ id: r.id, verb: r.verb, payload: r.payload, signature: r.signature }));
}

function fitsSize(v: unknown): boolean {
  if (v === undefined) return true;
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8') <= MAX_REPORT_BYTES;
  } catch {
    return false;
  }
}

export const commandUpdateSchema = z.object({
  id: z.string().regex(UUID),
  status: z.enum(AGENT_STATUSES),
  result: z.unknown().optional().refine(fitsSize, { message: 'result too large' })
});
export type CommandUpdate = z.infer<typeof commandUpdateSchema>;

export const statusReportSchema = z
  .record(z.string(), z.unknown())
  .refine(fitsSize, { message: 'status report too large' });
