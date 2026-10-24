import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canonicalPayload,
  commandUpdateSchema,
  COMMAND_VERBS,
  isTerminal,
  selectQueued,
  statusReportSchema,
  transition
} from '@/lib/ai-engine/box-commands';
import { BOX_FILES } from '@/lib/ai-engine/box-files';
import * as mac from '@/windows/jicate-ai-engine/box-command.mjs';
import * as signer from '@/windows/jicate-ai-engine/sign-box-file.mjs';
import { jsonbLiteral } from '@/windows/jicate-ai-engine/tower-sql.mjs';

const SIG = 'C'.repeat(86) + '==';
const ID = 'aaaaaaaa-2222-4333-8444-5555555555bb';
const DIR = resolve(__dirname, '..', 'windows', 'jicate-ai-engine');
const migration = readFileSync(resolve(__dirname, '..', 'supabase', 'migrations', '20261024_box_remote_control.sql'), 'utf8');

describe('lists stay in step', () => {
  it('verbs: lib, Mac script and the migration CHECK', () => {
    expect([...mac.VERBS]).toEqual([...COMMAND_VERBS]);
    for (const v of COMMAND_VERBS) expect(migration).toContain(`'${v}'`);
  });
  it('file names: lib, signer and the migration CHECK', () => {
    expect([...signer.FILES]).toEqual([...BOX_FILES]);
    const check = migration.slice(migration.indexOf('ai_box_files_name_check CHECK'), migration.indexOf('));'));
    expect(check.match(/'[^']+'/g)!.map((s) => s.slice(1, -1))).toEqual([...BOX_FILES]);
  });
  it('task XMLs a register-task may use are all allow-listed files', () => {
    for (const x of mac.TASK_XMLS) expect(BOX_FILES as readonly string[]).toContain(x);
  });
});

describe('box-commands (pure)', () => {
  it('payload keys are in contract order and identical on both sides', () => {
    const c = { expires_at: '2026-10-24T10:00:00.000Z', args: { task: 't' }, verb: 'restart-task', box: 'B', id: ID };
    const p = canonicalPayload(c);
    expect(Object.keys(JSON.parse(p))).toEqual(['id', 'box', 'verb', 'args', 'expires_at']);
    expect(mac.canonicalPayload(c)).toBe(p);
  });

  it('transitions: running only from queued; terminal from queued or running', () => {
    expect(transition('running', 'T')).toEqual({ from: ['queued'], set: { started_at: 'T' } });
    for (const s of ['done', 'failed', 'refused'] as const) {
      expect(transition(s, 'T')).toEqual({ from: ['queued', 'running'], set: { finished_at: 'T' } });
    }
    expect(['done', 'failed', 'refused', 'expired'].every(isTerminal)).toBe(true);
    expect(isTerminal('queued') || isTerminal('running')).toBe(false);
  });

  it('selectQueued drops expired, malformed and non-queued rows', () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    const base = { id: ID, verb: 'status', payload: '{}', signature: SIG, status: 'queued', expires_at: '2026-10-24T10:30:00.000Z', created_at: '2026-10-24T09:00:00.000Z' };
    const rows = [
      base,
      { ...base, expires_at: '2026-10-24T10:00:00.000Z' },
      { ...base, status: 'running' },
      { ...base, verb: 'format-c' },
      { ...base, signature: 'nope' },
      { ...base, id: 'not-a-uuid' }
    ];
    expect(selectQueued(rows, now)).toEqual([{ id: ID, verb: 'status', payload: '{}', signature: SIG }]);
  });

  it('command_update and status_report schemas', () => {
    expect(commandUpdateSchema.safeParse({ id: ID, status: 'done', result: { ok: 1 } }).success).toBe(true);
    expect(commandUpdateSchema.safeParse({ id: ID, status: 'expired' }).success).toBe(false);
    expect(commandUpdateSchema.safeParse({ id: ID.toUpperCase(), status: 'done' }).success).toBe(false);
    expect(statusReportSchema.safeParse({ host: 'x' }).success).toBe(true);
    expect(statusReportSchema.safeParse('x').success).toBe(false);
    expect(statusReportSchema.safeParse({ big: 'x'.repeat(200 * 1024) }).success).toBe(false);
  });
});

describe('box-command.mjs: args, expiry, signing, SQL', () => {
  const b64 = Buffer.from('Get-Date').toString('base64');

  it('validates args per verb', () => {
    expect(mac.validateArgs('status', {})).toBeNull();
    expect(mac.validateArgs('status', { x: 1 })).toMatch(/no args/);
    expect(mac.validateArgs('restart-task', { task: 'ai.jicate.engine-1' })).toBeNull();
    expect(mac.validateArgs('restart-task', { task: 'ai.jicate.box-agent' })).toMatch(/own task/);
    expect(mac.validateArgs('restart-task', { task: '\\AI.JICATE.BOX-AGENT' })).toMatch(/own task/);
    expect(mac.validateArgs('restart-task', { task: 'x" & del *' })).toMatch(/not a valid task/);
    expect(mac.validateArgs('register-task', { task: 'ai.jicate.engine-1', xml: 'ai.jicate.engine-1.xml' })).toBeNull();
    expect(mac.validateArgs('register-task', { task: 'ai.jicate.engine-1', xml: '..\\evil.xml' })).toMatch(/xml must be/);
    expect(mac.validateArgs('run-script', { shell: 'powershell', content_b64: b64, timeout_s: 60 })).toBeNull();
    expect(mac.validateArgs('run-script', { shell: 'bash', content_b64: b64, timeout_s: 60 })).toMatch(/shell/);
    expect(mac.validateArgs('run-script', { shell: 'cmd', content_b64: 'not base64!', timeout_s: 60 })).toMatch(/base64/);
    expect(mac.validateArgs('run-script', { shell: 'cmd', content_b64: '', timeout_s: 60 })).toMatch(/base64/);
    expect(mac.validateArgs('run-script', { shell: 'cmd', content_b64: b64, timeout_s: 601 })).toMatch(/timeout_s/);
    expect(mac.validateArgs('run-script', { shell: 'cmd', content_b64: b64 })).toMatch(/run-script takes/);
    expect(mac.validateArgs('format-c', {})).toMatch(/unknown verb/);
    expect(mac.validateArgs('status', [])).toMatch(/object/);
  });

  it('expiry defaults to 30m and is capped at 6h', () => {
    expect(mac.DEFAULT_EXPIRES).toBe('30m');
    expect(mac.parseExpires('30m')).toBe(30 * 60000);
    expect(mac.parseExpires('6h')).toBe(6 * 3600000);
    expect(() => mac.parseExpires('361m')).toThrow(/6h/);
    expect(() => mac.parseExpires('7h')).toThrow(/6h/);
    expect(() => mac.parseExpires('0m')).toThrow();
    expect(() => mac.parseExpires('1d')).toThrow();
    expect(() => mac.buildCommand({ box: 'B', verb: 'status', args: {}, expiresMs: 6 * 3600000 + 1 })).toThrow();
    expect(migration).toMatch(/expires_at - created_at <= interval '6 hours'/);
  });

  it('a signed command verifies with the public half of a fresh Ed25519 key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const now = new Date('2026-10-24T10:00:00.000Z');
    const c = mac.buildCommand({ box: 'WIN-AI', verb: 'restart-task', args: { task: 'ai.jicate.engine-2' }, expiresMs: 30 * 60000, now, id: ID });
    expect(c.payload).toBe(`{"id":"${ID}","box":"WIN-AI","verb":"restart-task","args":{"task":"ai.jicate.engine-2"},"expires_at":"2026-10-24T10:30:00.000Z"}`);
    const sig = mac.signPayload(c.payload, privateKey);
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    expect(verify(null, Buffer.from(c.payload, 'utf8'), publicKey, Buffer.from(sig, 'base64'))).toBe(true);
    // A changed byte (another box) fails.
    expect(verify(null, Buffer.from(c.payload.replace('WIN-AI', 'WIN-AJ'), 'utf8'), publicKey, Buffer.from(sig, 'base64'))).toBe(false);
  });

  it('refuses a bad box name', () => {
    expect(() => mac.buildCommand({ box: "x'; drop table", verb: 'status', args: {}, expiresMs: 60000 })).toThrow(/box/);
  });

  it('SQL carries the row only as hex, never as raw text', () => {
    const row = { id: ID, box: 'B', verb: 'status', payload: `{"x":"'; drop table ai_boxes; --$$"}`, signature: SIG, expires_at: 'T', created_by: "o'brien" };
    const sql = mac.insertSql(row);
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain("o'brien");
    expect(sql).toContain(jsonbLiteral(row));
    const hex = /decode\('([0-9a-f]+)', 'hex'\)/.exec(sql)![1];
    expect(JSON.parse(Buffer.from(hex, 'hex').toString('utf8'))).toEqual(row);
    expect(() => mac.statusSql("x' or 1=1")).toThrow();
    expect(mac.statusSql(ID)).toContain(`'${ID}'`);
  });

  it('--dry-run prints a row whose signature verifies, without reading the Supabase token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'box-cmd-'));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = join(dir, 'k.pem');
    writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const out = execFileSync(
      process.execPath,
      [join(DIR, 'box-command.mjs'), 'WIN-AI', 'status', '{}', '--key', pem, '--dry-run', '--expires', '10m'],
      { encoding: 'utf8', env: { ...process.env, HOME: dir } }
    );
    const { row, sql } = JSON.parse(out);
    expect(row.verb).toBe('status');
    expect(JSON.parse(row.payload).id).toBe(row.id);
    expect(verify(null, Buffer.from(row.payload, 'utf8'), publicKey, Buffer.from(row.signature, 'base64'))).toBe(true);
    expect(sql).toMatch(/^insert into public\.ai_box_commands/);
    const late = spawnSync(process.execPath, [join(DIR, 'box-command.mjs'), 'WIN-AI', 'status', '--key', pem, '--dry-run', '--expires', '7h'], { encoding: 'utf8' });
    expect(late.status).toBe(1);
    expect(late.stderr).toMatch(/6h/);
  });
});

describe('sign-box-file.mjs', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  it('signs a UTF-8 file; the signature verifies over the UTF-8 bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-'));
    const f = join(dir, 'jicate-mail.mjs');
    writeFileSync(f, '// mail\r\nconsole.log(1)\n');
    const s = signer.signBoxFile(f, privateKey);
    const bytes = readFileSync(f);
    expect(s.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(verify(null, bytes, publicKey, Buffer.from(s.signature, 'base64'))).toBe(true);
  });

  it('task XMLs: UTF-16LE with BOM is decoded, signed over UTF-8 of the text', () => {
    const real = join(DIR, 'ai.jicate.engine-1.xml');
    const s = signer.signBoxFile(real, privateKey);
    expect(s.content.startsWith('<?xml')).toBe(true);
    expect(s.content.charCodeAt(0)).not.toBe(0xfeff);
    const utf8 = Buffer.from(s.content, 'utf8');
    expect(s.sha256).toBe(createHash('sha256').update(utf8).digest('hex'));
    expect(verify(null, utf8, publicKey, Buffer.from(s.signature, 'base64'))).toBe(true);
    // What the agent must write back: BOM + UTF-16LE of the text = the original bytes.
    expect(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s.content, 'utf16le')]).equals(readFileSync(real))).toBe(true);
  });

  it('refuses a UTF-8 xml, a non-UTF-8 script and a name not on the list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-'));
    const xml = join(dir, 'ai.jicate.engine-2.xml');
    writeFileSync(xml, '<?xml version="1.0"?><Task/>');
    expect(() => signer.signBoxFile(xml, privateKey)).toThrow(/UTF-16LE/);
    const bad = join(dir, 'jicate-ai-drain.mjs');
    writeFileSync(bad, Buffer.from([0x2f, 0x2f, 0xff, 0x0a]));
    expect(() => signer.signBoxFile(bad, privateKey)).toThrow(/UTF-8/);
    const other = join(dir, 'evil.mjs');
    writeFileSync(other, 'x');
    expect(() => signer.signBoxFile(other, privateKey)).toThrow(/not a file/);
  });

  it('publish SQL is an upsert that carries content only as hex', () => {
    const row = { name: 'jicate-mail.mjs', sha256: 'a'.repeat(64), signature: SIG, content: "x = '$$'; -- drop", source: 'abc1234' };
    const sql = signer.publishSql(row);
    expect(sql).toMatch(/^insert into public\.ai_box_files/);
    expect(sql).toContain('on conflict (name) do update');
    expect(sql).not.toContain('drop');
    expect(sql).toContain(jsonbLiteral(row));
  });

  it('CLI still prints {name, sha256, signature} without --publish', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-'));
    const pem = join(dir, 'k.pem');
    writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const out = execFileSync(process.execPath, [join(DIR, 'sign-box-file.mjs'), join(DIR, 'run-jicate-ai-drain.cmd'), '--key', pem], { encoding: 'utf8' });
    const j = JSON.parse(out);
    expect(Object.keys(j)).toEqual(['name', 'sha256', 'signature']);
    expect(j.name).toBe('run-jicate-ai-drain.cmd');
    expect(verify(null, readFileSync(join(DIR, 'run-jicate-ai-drain.cmd')), publicKey, Buffer.from(j.signature, 'base64'))).toBe(true);
  });
});
