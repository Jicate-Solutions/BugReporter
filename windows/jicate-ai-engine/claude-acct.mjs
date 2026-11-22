#!/usr/bin/env node
/**
 * claude-acct.mjs — stands in for claude.exe for the MyJKKN max lanes on a box.
 *
 * Director, 11 Nov 2026 13:2x: "Let the Tower hand keys to Box 1". Each drain's
 * CLAUDE_BIN points here (through claude-acct.exe; claude-acct.cmd is a fallback). For every
 * Claude run this:
 *   1. reads the drain's stdin to the end (the prompt), so it can be replayed;
 *   2. asks the Control Tower which account to use
 *      (GET /api/internal/ai-engine/lane-key, lane runner token);
 *   3. runs the REAL claude.exe with the SAME arguments, unchanged (so the
 *      drain's fences — allowed tools, settings, model — stay exactly as they
 *      were), with CLAUDE_CODE_OAUTH_TOKEN set ONLY in that child's environment;
 *      — but ONLY when the arguments fence the run off from the shell and the
 *      web (fenceOf below; W12 review, PR #93). An unfenced run never gets a
 *      Tower key: the Tower is not even asked, and the run goes on the box's
 *      own sign-in exactly as before this shim.
 *      The one argument a fenced run does NOT get back unchanged is the value
 *      of --settings: the fence takes it only in one strict shape
 *      (strictSettings below) and hands claude the shim's OWN re-written JSON
 *      for it, so claude never reads text the shim did not check.
 *      A run that holds a Tower key also gets CLAUDE_CODE_DISABLE_FILE_MENTIONS=1
 *      in its environment (keyedEnv below): claude then no longer attaches a
 *      file named in the prompt as "@<path>", which the tool fence does not
 *      cover (W12 review, PR #100);
 *   4. if Claude refuses the account (usage limit, bad key, or the account's
 *      organisation has switched Claude Code off), asks again with
 *      refused=<label> and runs on the next account — at most once per account;
 *   5. hands the drain the output of the LAST run only, and its exit code.
 *
 * Floor: if the run is not fenced, or the Tower URL is not https, or the Tower
 * cannot be reached, refuses, rate-limits, or has no account left, the run goes
 * ahead exactly as before this shim (the box's own sign-in / whatever
 * environment the drain already had). One exception: a run that PASSED the
 * fence keeps the shim's re-written --settings value on every attempt, the
 * own sign-in included (same settings, the shim's spelling). The own sign-in
 * never gets CLAUDE_CODE_DISABLE_FILE_MENTIONS from the shim: its environment
 * is the drain's own, untouched.
 *
 * The key is held in memory only: never written to disk, never logged, never
 * put on a command line. The log line per run (logs\claude-acct.log next to
 * this file) carries the account label, attempt count and exit code only.
 *
 * Settings (environment of the drain, or defaults):
 *   CLAUDE_REAL_BIN   the real claude.exe   (default C:\Users\Admin\.local\bin\claude.exe)
 *   TOWER_LANE_ENV    file with JICATE_AI_URL= (https only; plain http only for
 *                     localhost) and JICATE_AI_RUNNER_TOKEN=
 *                     (default C:\jicate-ai\maxlane-biometric.env, made by
 *                     new-runner-token.ps1 -Runner maxlane-biometric)
 *   CLAUDE_ACCT_LOG   log file             (default <this folder>\logs\claude-acct.log)
 *   CLAUDE_ACCT_OFF=1 skip the Tower entirely (instant undo without touching drains)
 */

import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, win32, posix } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_BIN = process.env.CLAUDE_REAL_BIN || 'C:\\Users\\Admin\\.local\\bin\\claude.exe';
const ENV_FILE = process.env.TOWER_LANE_ENV || 'C:\\jicate-ai\\maxlane-biometric.env';
const LOG_FILE = process.env.CLAUDE_ACCT_LOG || join(HERE, 'logs', 'claude-acct.log');
const ASK_TIMEOUT_MS = Number(process.env.CLAUDE_ACCT_ASK_TIMEOUT_MS) || 15_000;
const STDIN_WAIT_MS = 3_000;
const MAX_ATTEMPTS = 6;

// Same patterns as jicate-ai-drain.mjs, minus "overloaded" (a server-wide
// state; another account would not help).
// Claude's real wording varies: "You've hit your limit", "You've hit your weekly limit · resets ...",
// "5-hour limit", "session limit" (Box 1, 15 Nov 2026: the weekly wording did not match before).
// The weekly / session / 5-hour words count only in a limit message ("hit your ... limit",
// "... limit reached", "... limit · resets"), never alone: a run that failed for another
// reason and merely mentions "weekly limit" must not roll to the next account (W12, #94).
export const LIMIT_RE = /rate.?limit|usage limit|hit your [a-z0-9 -]{0,20}limit|limit reached|(?:weekly|session|5-hour) limit\W{0,3}resets|too many requests|\b429\b/i;
export const AUTH_RE = /failed to authenticate|oauth access token|invalid api key|not logged in|\b401\b/i;
// "Your organization has disabled Claude subscription access for Claude Code": the account
// cannot run here at all, so it rolls like a bad key. The WHOLE phrase only (spaces may be
// any white space, any case): a run that merely says "organization" must not roll.
export const ORG_BLOCK_RE = /your\s+organization\s+has\s+disabled\s+claude\s+subscription\s+access\s+for\s+claude\s+code/i;

/**
 * Tools a run may be allowed and still get a Tower key. Read / search only:
 * none of them runs a command, reaches the network, or writes a file (a run
 * that can write could plant .claude/settings.json hooks or .mcp.json in its
 * folder for the next run to start, key in hand). Anything else — Bash,
 * PowerShell, WebFetch, WebSearch, Edit, Write, Task/Agent, mcp__*, "default",
 * a name we do not know — means no key.
 * The file tools must be scoped to the run's own folder, "Read(./**)" style:
 * a bare "Read" or "Read(C:/...)" can reach C:\jicate-ai\maxlane-biometric.env
 * (the lane token) wherever it sits (W12 re-review, PR #93).
 */
export const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite']);
const PATH_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const SAFE_PERMISSION_MODES = new Set(['dontAsk', 'default', 'plan']);

/** claude options that change nothing the fence cares about. */
const PLAIN_FLAGS = new Set([
  '-p', '--print', '--verbose', '--strict-mcp-config', '--no-session-persistence', '--include-partial-messages',
  '--include-hook-events', '--replay-user-messages', '--fork-session', '--bare', '--safe-mode',
  '--disable-slash-commands', '--exclude-dynamic-system-prompt-sections', '--forward-subagent-text', '--mcp-debug',
  '--restricted', '-c', '--continue'
]);
/** claude options that take exactly one value (claude reads the next argument as it, whatever it is). */
const VALUE_OPTIONS = new Set([
  '--model', '--fallback-model', '--output-format', '--input-format', '--system-prompt', '--append-system-prompt',
  '--system-prompt-file', '--append-system-prompt-file', '--max-turns', '--max-budget-usd', '--json-schema',
  '--session-id', '--effort', '--autocompact', '--name', '-n', '--debug-file', '--system-prompt-snapshot',
  '--permission-prompts'
]);
/** claude options whose value is optional (taken only when it does not start with "-"). */
const OPTIONAL_VALUE_OPTIONS = new Set(['-r', '--resume', '-d', '--debug', '--prompt-suggestions']);
/**
 * Options that bring in tools, programs, folders or approvers the fence cannot see.
 * --settings is not here: it is taken in ONE strict shape only (strictSettings).
 */
const UNSAFE_OPTIONS = new Map([
  ['--dangerously-skip-permissions', 'permission bypass'],
  ['--allow-dangerously-skip-permissions', 'permission bypass'],
  ['--permission-prompt-tool', 'permission bypass'],
  ['--mcp-config', 'MCP, plugin or settings by argument'],
  ['--plugin-dir', 'MCP, plugin or settings by argument'],
  ['--plugin-url', 'MCP, plugin or settings by argument'],
  ['--add-dir', 'extra folders by argument']
]);
/** Why a --settings argument got no key. Fixed words: the value is never echoed. */
const SETTINGS_REASON = 'settings by argument: not the strict shape';

/** "Read(./a),Grep Bash(git *)" -> ['Read(./a)', 'Grep', 'Bash(git *)'] (commas/spaces outside brackets split). */
function toolNames(value) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** null when the tool rule is allowed, else the reason. */
function toolProblem(rule) {
  const m = rule.match(/^([A-Za-z]+)(?:\((.*)\))?$/s);
  if (!m || !SAFE_TOOLS.has(m[1])) return 'shell, web or unknown tool allowed';
  if (!PATH_TOOLS.has(m[1])) return null;
  const spec = m[2];
  if (spec === undefined || !spec.startsWith('./') || spec.includes('..')) return 'file tool not scoped to ./';
  return null;
}

/**
 * JSON text -> value, like JSON.parse, but an object comes back as a Map and a
 * key written twice in one object throws (JSON.parse silently keeps the last
 * one, and another reader may keep the first). Keys are compared AFTER their
 * escapes are decoded, so "permi\u0073sions" is "permissions". Only called on
 * text JSON.parse already took, so validity is JSON.parse's call, not ours.
 */
function parseNoDuplicateKeys(text) {
  let i = 0;
  const fail = () => { throw new Error('not strict JSON'); };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const string = () => {
    const start = i++; // on the opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail();
    return JSON.parse(text.slice(start, ++i));
  };
  const value = (depth) => {
    if (depth > 4) fail(); // the strict shape is 3 deep
    ws();
    const ch = text[i];
    if (ch === '"') return string();
    if (ch === '{') {
      const obj = new Map();
      i++;
      ws();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const key = string();
        if (obj.has(key)) fail(); // written twice
        ws();
        if (text[i++] !== ':') fail();
        obj.set(key, value(depth + 1));
        ws();
        const next = text[i++];
        if (next === '}') return obj;
        if (next !== ',') fail();
      }
    }
    if (ch === '[') {
      const arr = [];
      i++;
      ws();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        const next = text[i++];
        if (next === ']') return arr;
        if (next !== ',') fail();
      }
    }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 64));
    if (!m) fail();
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  const v = value(0);
  ws();
  if (i !== text.length) fail();
  return v;
}

const SETTINGS_MAX_CHARS = 16_384;
const POLLUTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** A deny rule: ToolName or ToolName(...), one rule per string. Deny only narrows, so any tool name will do. */
const DENY_RULE_RE = /^[A-Za-z][A-Za-z0-9_-]*(?:\(.*\))?$/s;

/**
 * The ONE shape of --settings value a fenced run may carry (proof-read.mjs,
 * Box 1, Nov 2026). Returns the shim's own JSON text for it, or null.
 *   {"permissions":{"allow":[...],"deny":[...],"defaultMode":"..."}}
 * - JSON text for an object, written inline (a file path is refused: the shim
 *   cannot see what a file says, or what it will say when claude opens it);
 * - top level: "permissions" only. So no hooks, env, apiKeyHelper, model,
 *   mcpServers, enabledPlugins, additionalDirectories: each of those can run a
 *   program with the key in its environment, send the key elsewhere, or open
 *   folders outside the run's own;
 * - permissions: "allow", "deny", "defaultMode" only (no additionalDirectories,
 *   no ask);
 * - every allow rule passes the SAME check as an --allowedTools rule
 *   (toolProblem), one rule per string;
 * - every deny rule looks like a tool rule (deny can only narrow);
 * - defaultMode is one of SAFE_PERMISSION_MODES;
 * - no key written twice, no "__proto__" / "constructor" / "prototype" key, no
 *   array entry that is not a string.
 * The text handed back is built from scratch from the checked values, keys in
 * a fixed order, so what claude parses is exactly what was checked here.
 * @param {string} raw
 * @returns {string | null}
 */
export function strictSettings(raw) {
  if (typeof raw !== 'string' || raw.length > SETTINGS_MAX_CHARS) return null;
  const text = raw.trim();
  if (!text.startsWith('{')) return null; // a file path, an array, a string, a number, null
  let top;
  try {
    JSON.parse(text); // is it JSON at all
    top = parseNoDuplicateKeys(text);
  } catch {
    return null;
  }
  if (!(top instanceof Map)) return null;
  const onlyKeys = (map, allowed) => [...map.keys()].every((k) => !POLLUTING_KEYS.has(k) && allowed.includes(k));
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!onlyKeys(top, ['permissions'])) return null;
  const out = {};
  if (top.has('permissions')) {
    const perms = top.get('permissions');
    if (!(perms instanceof Map) || !onlyKeys(perms, ['allow', 'deny', 'defaultMode'])) return null;
    const p = {};
    if (perms.has('allow')) {
      const allow = perms.get('allow');
      if (!strings(allow)) return null;
      for (const rule of allow) {
        // one rule per string (as --allowedTools would split it), and a safe one
        const split = toolNames(rule);
        if (split.length !== 1 || split[0] !== rule || toolProblem(rule)) return null;
      }
      p.allow = [...allow];
    }
    if (perms.has('deny')) {
      const deny = perms.get('deny');
      if (!strings(deny)) return null;
      for (const rule of deny) {
        const split = toolNames(rule);
        if (split.length !== 1 || split[0] !== rule || !DENY_RULE_RE.test(rule)) return null;
      }
      p.deny = [...deny];
    }
    if (perms.has('defaultMode')) {
      const mode = perms.get('defaultMode');
      if (typeof mode !== 'string' || !SAFE_PERMISSION_MODES.has(mode)) return null;
      p.defaultMode = mode;
    }
    out.permissions = p;
  }
  return JSON.stringify(out);
}

/**
 * How many arguments, in the WHOLE list ("--" and what follows included), are
 * a settings option: "--settings", "--managed-settings", or either with
 * "=<value>". The whole argument only: prompt text that merely mentions one
 * does not count ("--setting-sources" is counted by sourcesTokens).
 * @param {string[]} args
 */
function settingsTokens(args) {
  return args.filter((a) => /^--(?:managed-)?settings(?:=|$)/.test(a)).length;
}

/** Why a "--setting-sources" token past "--" got no key. Fixed words. */
const SOURCES_REASON = '--setting-sources after "--"';

/**
 * How many arguments, in the WHOLE list ("--" and what follows included), are
 * "--setting-sources" or "--setting-sources=<value>". The whole argument only:
 * a longer argument that merely contains the words does not count.
 * @param {string[]} args
 */
function sourcesTokens(args) {
  return args.filter((a) => /^--setting-sources(?:=|$)/.test(a)).length;
}

/**
 * May this claude run be handed a Tower key? Parses the drain's arguments the
 * way claude.exe (commander) does, so a flag hidden as another option's value
 * or after "--" is not mistaken for a fence. A key is handed ONLY when ALL of:
 *   - --tools, the set of tools claude LOADS, with plain names from SAFE_TOOLS
 *     only (e.g. --tools Read,Grep,Glob; "" = no tools). So Bash, PowerShell
 *     and WebFetch are not even loaded, and the fence does not rest on
 *     dontAsk or on claude's own list of read-only commands (W12 round 3);
 *   - any --allowedTools / --allowed-tools rules (optional) are SAFE_TOOLS
 *     entries with file tools scoped by a relative "./" path and no "..",
 *     e.g. Read(./**);
 *   - --setting-sources is given and leaves out "user": on Box 1
 *     C:\Users\Admin\.claude\settings.json defaults to bypassPermissions, so
 *     an allow list alone is NOT a fence there (found 8 Nov 2026);
 *   - --permission-mode is given and is dontAsk, default or plan;
 *   - --strict-mcp-config (no MCP servers from the user's config: they would
 *     start with the key in their environment);
 *   - no option from UNSAFE_OPTIONS (bypass, --permission-prompt-tool, MCP,
 *     plugins, --add-dir), and no option this list does not know
 *     (fails safe: add a real drain's harmless option here if one needs it);
 *   - --settings, if given at all: once only in the whole argument list, as
 *     "--settings <value>" (never "--settings=<value>"), with a value in the
 *     strict shape (strictSettings: inline JSON, permissions.allow / deny /
 *     defaultMode and nothing else). A file path gets no key;
 *   - no other argument anywhere, past "--" included, that is "--settings",
 *     "--managed-settings", or either with "=<value>" (settingsTokens);
 *   - no argument past "--" that is "--setting-sources" or
 *     "--setting-sources=<value>" (sourcesTokens): there it could name "user";
 *   - no option value that starts with "-" (a flag hidden as a value).
 * A tool list takes every following argument up to the next one starting with
 * "-", as claude does, so a prompt passed after the list reads as an unknown
 * tool and the run gets no key (fails safe; the drains pass the prompt on stdin).
 * Everything after "--" is prompt text to claude and is not read as options,
 * with the exceptions above: a settings token or a "--setting-sources" token
 * there still means no key. commander stops at "--", but claude also looks
 * for its settings options in a scan of its own before commander runs, and
 * the fence does not rest on that scan stopping at "--" in every claude
 * version. The fenced helpers pass the prompt on stdin, so nothing real is
 * lost.
 * Settings FILES in the drain's folder (permissions.allow, hooks, MCP servers)
 * are not visible here: ACCOUNTS.md install step 1 checks them.
 * Returns { ok: true, args } or { ok: false, reason } — reason is a fixed
 * phrase, never argument text. "args" is what to hand claude on a run that
 * may hold a key: the same arguments, except that a --settings value is
 * replaced by the shim's own JSON for it (strictSettings).
 * @param {string[]} args
 * @returns {{ ok: boolean, reason?: string, args?: string[] }}
 */
export function fenceOf(args) {
  const checked = args.map(String);
  const settingsCount = settingsTokens(checked);
  const sourcesCount = sourcesTokens(checked);
  let settingsSeen = false;
  let sourcesSeen = 0;
  let toolSet = false;
  let mode_ = false;
  let sources_ = false;
  let strictMcp = false;
  const no = (reason) => ({ ok: false, reason });
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') break; // the rest is prompt text to claude
    if (!a.startsWith('-')) continue; // a prompt / positional
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : null;
    /** The one value of a value option; null when it is missing or looks like a flag. */
    const takeOne = () => {
      if (inline !== null) return inline;
      if (i + 1 >= args.length) return null;
      const v = String(args[++i]);
      return v.startsWith('-') ? null : v;
    };
    /**
     * The values of a list option; null when the value is missing or starts
     * with "-": claude then takes that next flag AS a tool name, so the flag
     * never applies and the list is empty (W12 round 4). --tools "" and
     * --tools= are fine: their value is "".
     */
    const takeList = () => {
      if (inline === null && (i + 1 >= args.length || String(args[i + 1]).startsWith('-'))) return null;
      const vals = inline !== null ? [inline] : [];
      while (i + 1 < args.length && !String(args[i + 1]).startsWith('-')) vals.push(String(args[++i]));
      return vals;
    };
    if (UNSAFE_OPTIONS.has(flag)) return no(UNSAFE_OPTIONS.get(flag));
    if (PLAIN_FLAGS.has(flag)) {
      if (inline !== null) return no('unknown or unsafe option');
      if (flag === '--strict-mcp-config') strictMcp = true;
      continue;
    }
    if (VALUE_OPTIONS.has(flag)) {
      if (takeOne() === null) return no('option value looks like a flag');
      continue;
    }
    if (OPTIONAL_VALUE_OPTIONS.has(flag)) {
      if (inline === null && i + 1 < args.length && !String(args[i + 1]).startsWith('-')) i++;
      continue;
    }
    switch (flag) {
      case '--tools': {
        // The loaded tool set: plain names only (claude takes "Bash,Edit,Read" here).
        toolSet = true;
        const vals = takeList();
        if (vals === null) return no('option value looks like a flag');
        for (const v of vals) {
          for (const t of toolNames(v)) {
            if (!SAFE_TOOLS.has(t)) return no(/^[A-Za-z]+\(/.test(t) ? 'bad --tools entry' : 'shell, web or unknown tool allowed');
          }
        }
        break;
      }
      case '--allowedTools':
      case '--allowed-tools': {
        const vals = takeList();
        if (vals === null) return no('option value looks like a flag');
        for (const v of vals) {
          for (const t of toolNames(v)) {
            const problem = toolProblem(t);
            if (problem) return no(problem);
          }
        }
        break;
      }
      case '--disallowedTools':
      case '--disallowed-tools':
        if (takeList() === null) return no('option value looks like a flag'); // only narrows otherwise
        break;
      case '--permission-mode': {
        const mode = takeOne();
        if (mode === null || !SAFE_PERMISSION_MODES.has(mode)) return no('permission bypass');
        mode_ = true;
        break;
      }
      case '--setting-sources': {
        sourcesSeen++;
        const v = takeOne();
        if (v === null) return no('option value looks like a flag');
        if (v.split(',').map((x) => x.trim()).includes('user')) return no('user settings loaded');
        sources_ = true;
        break;
      }
      case '--settings': {
        // Once only, anywhere in the list (also past "--"), value as the next argument.
        if (settingsSeen || settingsCount !== 1 || inline !== null) return no(SETTINGS_REASON);
        settingsSeen = true;
        const v = takeOne();
        const canonical = v === null ? null : strictSettings(v);
        if (canonical === null) return no(SETTINGS_REASON);
        checked[i] = canonical; // claude gets the text the shim wrote, not the text it was given
        break;
      }
      default:
        return no('unknown or unsafe option');
    }
  }
  // A settings token the loop never read: it sits past "--" (before "--" the
  // loop has either checked it or refused the run already).
  if (settingsCount !== (settingsSeen ? 1 : 0)) return no(SETTINGS_REASON);
  if (!toolSet) return no('no --tools list');
  if (!sources_) return no('no --setting-sources without user');
  if (!mode_) return no('no --permission-mode');
  if (!strictMcp) return no('no --strict-mcp-config');
  // A "--setting-sources" token the loop never read: it sits past "--" (before
  // "--" the loop has either read it or refused the run already). Checked last,
  // so a run refused for any other reason keeps that reason.
  if (sourcesCount !== sourcesSeen) return no(SOURCES_REASON);
  return { ok: true, args: checked };
}

/**
 * The drain's environment, for a run that would get a Tower key. A run whose
 * ANTHROPIC_BASE_URL points elsewhere would send the account key to that host.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, reason?: string }}
 */
export function envFenceOf(env) {
  if (env.ANTHROPIC_BASE_URL) return { ok: false, reason: 'ANTHROPIC_BASE_URL set' };
  return { ok: true };
}

/**
 * claude's own switch for "@<path>" in the prompt. Read in the claude 2.1.329
 * program text (also 2.1.326 - 2.1.328): with it truthy ("1", "true", "yes",
 * "on") claude no longer opens a file the prompt names as @<path>; it only
 * notes "Referenced <path> (not read)". Without it claude ATTACHES that file
 * unless a deny rule covers the path, and "./" allow rules, --tools and
 * dontAsk do not stop it: the tool fence is about tools, and this is not a
 * tool call. The helpers put staff-typed text and text from uploads into the
 * prompt, so a keyed run without the switch could be handed
 * @C:\jicate-ai\maxlane-biometric.env.
 */
export const NO_FILE_MENTIONS = 'CLAUDE_CODE_DISABLE_FILE_MENTIONS';

/**
 * The environment of a run that holds a Tower key: the drain's environment,
 * the key, and the file-mention switch ON. Built in ONE place so the switch
 * can never be left off a keyed run. Any other spelling of the switch's name
 * in the drain's environment is dropped first (Windows variable names ignore
 * case, so "claude_code_disable_file_mentions=0" would be the same variable).
 * @param {Record<string, string | undefined>} baseEnv
 * @param {string} key
 * @returns {Record<string, string | undefined>}
 */
export function keyedEnv(baseEnv, key) {
  const env = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (name.toUpperCase() !== NO_FILE_MENTIONS) env[name] = value;
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = key;
  env[NO_FILE_MENTIONS] = '1';
  return env;
}

/**
 * Is the lane-token file inside the folder claude runs in (or that folder
 * itself)? Then even Read(./**) reaches it, with no link needed.
 * Case-insensitive on Windows.
 */
export function tokenInsideFolder(envFile, cwd, platform = process.platform) {
  const P = platform === 'win32' ? win32 : posix;
  // realpathSync.native asks the OS for the final path (on Windows
  // GetFinalPathNameByHandle), so 8.3 short names (C:\JICATE~1), \\?\ prefixes,
  // subst drives and links all come out in one spelling (W12 round 4).
  const real = (p) => {
    const abs = P.resolve(p);
    if (platform !== process.platform) return abs;
    try { return realpathSync.native(abs); } catch { /* fall through */ }
    try { return realpathSync(abs); } catch { return abs; }
  };
  const strip = (p) => (platform === 'win32' ? p.replace(/^\\\\\?\\(?!UNC\\)/i, '') : p);
  let dir = strip(real(P.dirname(P.resolve(envFile))));
  let folder = strip(real(cwd));
  if (platform === 'win32') { dir = dir.toLowerCase(); folder = folder.toLowerCase(); }
  const rel = P.relative(folder, dir);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel));
}

/** The Tower URL, only if https (plain http allowed for localhost tests). */
export function towerUrlOk(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function log(line) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  } catch { /* logging must never break a run */ }
}

function readEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * The drain's stdin, whole. A drain that never writes or closes stdin would
 * hang us, so with no first byte within 3 s we take it as empty (claude.exe
 * itself does the same).
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((done) => {
    const chunks = [];
    let started = false;
    const timer = setTimeout(() => {
      if (!started) finish();
    }, STDIN_WAIT_MS);
    function finish() {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(Buffer.concat(chunks));
    }
    process.stdin.on('data', (c) => {
      started = true;
      chunks.push(c);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

/** Ask the Tower. Returns { label, key } or { none: reason }. Never throws. */
async function askTower(cfg, refused) {
  const q = new URLSearchParams({ host: hostname().slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '-') });
  if (refused.length) q.set('refused', refused.join(','));
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/api/internal/ai-engine/lane-key?${q}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.label === 'string' && typeof body.key === 'string' && body.key.length > 20) {
      return { label: body.label, key: body.key };
    }
    return { none: `tower ${res.status} ${body?.error?.code ?? ''}`.trim() };
  } catch (e) {
    return { none: `tower unreachable (${e?.name ?? 'error'})` };
  }
}

/** One run of the real claude.exe. Output is buffered, not passed on yet. */
function runClaude(args, env, input) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(REAL_BIN, args, {
        env,
        stdio: [input === null ? 'inherit' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      done({ code: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(`claude-acct: cannot start ${REAL_BIN}: ${e.message}\n`) });
      return;
    }
    current = child;
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => err.push(Buffer.from(`claude-acct: cannot start ${REAL_BIN}: ${e.message}\n`)));
    child.on('close', (code, signal) => {
      current = null;
      done({ code: code ?? (signal ? 1 : 0), stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    if (input !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * Why a finished run failed, if it is the account's fault: 'limit', 'auth',
 * 'org' (its organisation has switched Claude Code off for subscriptions) or
 * null. Any of the three rolls to the next account the same way. Only a failed run counts (non-zero exit, or a JSON result with
 * is_error) — the text of a good answer is never matched. stream-json's
 * rate_limit_event lines (present on every run) are ignored, and with JSON
 * output only stderr and the final result line are read.
 */
export function refusalOf(run) {
  const outText = run.stdout.toString('utf8');
  const lines = outText.split(/\r?\n/).filter((l) => l.trim() && !l.includes('"rate_limit_event"'));
  let isError = false;
  let parsedLast = false;
  const last = lines.at(-1);
  if (last) {
    try {
      isError = JSON.parse(last)?.is_error === true;
      parsedLast = true;
    } catch { /* plain text output */ }
  }
  if (run.code === 0 && !isError) return null;
  // JSON output: only the final result line counts, never the transcript before
  // it (a run that failed for another reason may mention "429" anywhere).
  const text = `${run.stderr.toString('utf8')}\n${parsedLast ? last : lines.join('\n')}`;
  if (LIMIT_RE.test(text)) return 'limit';
  if (AUTH_RE.test(text)) return 'auth';
  if (ORG_BLOCK_RE.test(text)) return 'org';
  return null;
}

let current = null;

/** Stop the running claude.exe and everything it started. */
function killCurrent() {
  const c = current;
  if (!c?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      c.kill('SIGKILL');
    }
  } catch { /* already gone */ }
}

/**
 * A drain's timeout kills what it started — the .cmd's cmd.exe or
 * claude-acct.exe — not this node process or the claude.exe under it. So
 * every 2 s: if the process that started us is gone, stop claude and leave,
 * instead of leaving a run spending the account with nobody waiting for it.
 */
const START_PPID = process.ppid;
function parentGone() {
  if (process.ppid !== START_PPID) return true; // re-parented (macOS / Linux)
  try {
    process.kill(START_PPID, 0);
    return false;
  } catch (e) {
    return e?.code !== 'EPERM'; // EPERM = alive, not ours to signal
  }
}
function watchParent() {
  setInterval(() => {
    if (!parentGone()) return;
    log('parent gone: stopping claude');
    killCurrent();
    process.exit(137);
  }, Number(process.env.CLAUDE_ACCT_PARENT_POLL_MS) || 2_000).unref();
}

function onSignals() {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    try {
      process.on(sig, () => {
        killCurrent();
        process.exit(130);
      });
    } catch { /* signal not supported on this platform */ }
  }
}

async function main() {
  onSignals(); // here, not at import, so tests can import fenceOf safely
  watchParent();
  const args = process.argv.slice(2);
  const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
  const real = (() => { try { return realpathSync(resolve(REAL_BIN)); } catch { return resolve(REAL_BIN); } })();
  if (/^claude-acct/i.test(basename(real)) || real === self) {
    process.stderr.write('claude-acct: CLAUDE_REAL_BIN points at the shim itself; set it to the real claude.exe\n');
    return 2;
  }

  // Our own child must never come back through us, whatever its PATH says.
  const baseEnv = { ...process.env, CLAUDE_ACCT_ACTIVE: '1' };
  const input = await readStdin();

  let cfg = null;
  // What claude is started with. A run that passed the fence gets the fence's
  // own copy (a --settings value re-written by the shim) on EVERY attempt, the
  // own sign-in included; any other run gets the drain's arguments untouched.
  let runArgs = args;
  const argFence = fenceOf(args);
  const envFence = argFence.ok ? envFenceOf(process.env) : argFence;
  const fence = envFence.ok && tokenInsideFolder(ENV_FILE, process.cwd())
    ? { ok: false, reason: 'token file inside the working folder' }
    : envFence;
  if (process.env.CLAUDE_ACCT_OFF !== '1' && process.env.CLAUDE_ACCT_ACTIVE !== '1') {
    if (!fence.ok) {
      // Not fenced off from the shell / web: never ask for a key.
      log(`fence: no Tower key (${fence.reason})`);
    } else {
      runArgs = argFence.args;
      try {
        const f = readEnvFile(ENV_FILE);
        if (f.JICATE_AI_URL && f.JICATE_AI_RUNNER_TOKEN) {
          if (towerUrlOk(f.JICATE_AI_URL)) cfg = { url: f.JICATE_AI_URL, token: f.JICATE_AI_RUNNER_TOKEN };
          else log('tower: refused a non-https JICATE_AI_URL');
        }
      } catch { /* no env file: run as before */ }
    }
  }

  const refused = [];
  const tried = new Set();
  let ownTried = false;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pick = cfg ? await askTower(cfg, refused) : { none: 'tower not configured' };
    let env;
    let label;
    if (pick.key && !tried.has(pick.label)) {
      label = pick.label;
      tried.add(label);
      env = keyedEnv(baseEnv, pick.key); // the key, and file mentions off
    } else {
      if (ownTried) break; // the floor ran already: hand back what we have
      ownTried = true;
      label = 'own-sign-in';
      env = baseEnv; // exactly what the drain had before this shim
      if (pick.none) log(`tower: ${pick.none}`);
    }
    last = await runClaude(runArgs, env, input);
    const why = refusalOf(last);
    log(`attempt=${attempt} account=${label} exit=${last.code}${why ? ` refused=${why}` : ''}`);
    if (!why || label === 'own-sign-in' || input === null) break;
    refused.push(label);
  }

  process.stdout.write(last.stdout);
  process.stderr.write(last.stderr);
  return last.code;
}

const isMain = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  main().then(
    (code) => { process.exitCode = code; },
    (e) => {
      log(`crashed: ${e?.message ?? e}`);
      process.stderr.write(`claude-acct: ${e?.message ?? e}\n`);
      process.exitCode = 1;
    }
  );
}
