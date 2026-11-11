Adding Claude accounts to the JICATE workers
============================================

Director, 2026-10-19: up to 5 extra Claude Max accounts, switched per Windows
box from the Control Tower (AI Routines page) as their allowance runs down.

Labels: give each account ONE short label and use the SAME label on every box,
for example acct1 ... acct5. The Control Tower tracks usage by label.
"default" is each box's own sign-in (today aicse) and is always there.

For EACH account (the Director does this; Claude cannot sign in for you):
1. On any one computer, in a normal terminal or PowerShell window (NOT a Claude
   tab), run:  claude setup-token
   Sign in to that account in the browser it opens. Copy the key it prints.
2. On EACH Windows box, in C:\jicate-ai\ run:
     node save-claude-account.mjs acct1
   Paste the same key (it is hidden), press Enter.
   Expect: account=acct1 saved and works
   The key is saved in C:\jicate-ai\accounts\acct1.token, readable only by that
   Windows user. It is never shown, logged or sent anywhere.
3. Within a minute each worker tells the Control Tower it holds acct1, and the
   account appears in the pickers on the AI Routines page.

Then, on the AI Routines page ("Claude accounts" card):
- Each account shows two bars, this 5 hours and this week, with reset times,
  from the latest job that ran on it.
- Give each account a priority number (1 = use first).
- Switch a whole box with one choice: default, any label, or "auto (priority
  list)": workers use the lowest-numbered account that still has allowance
  (both windows under 95%), move to the next when it runs out, and switch
  back by themselves when an earlier account's 5-hour or weekly allowance
  renews. Accounts with no number come last; ties go to the least-used.
- You get an email when any account passes 90% of either allowance.
- With "fall back" on (the default), a worker whose account hits its limit
  moves to its next account by itself.

Risk to know: each .token file is a long-lived key for a paid account. Anyone
who gets a box's files gets those accounts. Keep the boxes locked; to revoke an
account, delete its .token file on every box and sign out of it at claude.ai.

MyJKKN max lanes on Box 1: the Tower hands out keys (claude-acct)
=================================================================

Director, 11 Nov 2026 13:2x: "Let the Tower hand keys to Box 1". Box 1
(BIOMETRIC) runs ~14 MyJKKN drains under C:\Users\Admin\jkkn-max-lane\ on the
box's own sign-in only; when that hit its limit at 08:49 every MyJKKN job
stopped. With this, each Claude run on those drains asks the Tower which
stored account to use (same priority list as the JICATE workers), runs on it,
and moves to the next account by itself when Claude refuses one.

Files (in C:\jicate-ai\):
  claude-acct.mjs            the stand-in for claude.exe (Node, no packages)
  claude-acct-launcher.cs    source of claude-acct.exe: THE launcher (default)
  claude-acct.cmd            fallback only, if the .exe cannot be built (step 4);
                             cmd.exe re-reads %* so job text in an argument could
                             inject commands
Tower side: GET /api/internal/ai-engine/lane-key (merged PR; see its header).

Install (after the PR is merged and live; only on the Director's yes):
1. Check first:
   - node --version on Box 1 is 18 or newer (the shim needs fetch);
   - EVERY drain reads CLAUDE_BIN from its environment. Some older drains
     hardcode C:\Users\Admin\.local\bin\claude.exe; those need a one-line
     MyJKKN change first, or they will simply keep running as today.
   - THE TOOL FENCE (W12 review, PR #93). A Tower key is handed ONLY to a run
     whose arguments carry --allowedTools / --allowed-tools / --tools with
     read/edit file tools only (Read, Glob, Grep, LS, NotebookRead, TodoWrite,
     Edit, MultiEdit, Write, NotebookEdit; "" = no tools is fine), and no
     --dangerously-skip-permissions, no bypass/auto --permission-mode, no
     --mcp-config / --plugin-dir / --plugin-url / --settings. Any other run
     (Bash, PowerShell, WebFetch, WebSearch, Task, mcp__*, no list at all) runs
     on the box's own sign-in, logged "fence: no Tower key (<reason>)". So a
     prompt-injected job that can shell out or reach the web never holds an
     account key. List every drain BEFORE install and fill this table (the
     drains are not in any repo, so this has NOT been checked yet):

       | drain (task name) | claude arguments (tool list, permission mode) | box/project settings permissions.allow, hooks, MCP servers | gets a Tower key? |
       |-------------------|-----------------------------------------------|-------------------------------------------------------------|-------------------|
       | (fill on the box) |                                               |                                                             |                   |

     To fill it: Get-CimInstance Win32_Process -Filter "name='claude.exe'" |
     Select CommandLine  (while the drains run), and read
     C:\Users\Admin\.claude\settings.json plus each drain folder's
     .claude\settings*.json. The shim cannot see settings FILES: a drain whose
     settings allow Bash / PowerShell / WebFetch / WebSearch, or start MCP
     servers or hooks, must not be pointed at the shim (leave its CLAUDE_BIN
     as the real claude.exe) until that is removed.
   - maxlane-biometric.env stays in C:\jicate-ai\, OUTSIDE every drain's
     working folder (a run allowed Read must not be able to reach it).
2. Lane token, made ON the box (prints only a hash; secret stays in the file):
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner maxlane-biometric
   Send the printed "runner=maxlane-biometric sha256=..." line to the Box desk.
   The Box desk inserts it into ai_runner_tokens (runner maxlane-biometric).
   The name MUST start with "maxlane-": only such tokens open /lane-key, and
   they cannot claim or answer JICATE jobs.
3. Copy claude-acct.mjs, claude-acct.cmd and claude-acct-launcher.cs into
   C:\jicate-ai\ and check their SHA-256s. In claude-acct.cmd replace
   __NODE_EXE__ with the full path of node.exe.
4. Build the launcher (default) and PROBE it the way the drains start it
   (execFile with no shell):
     C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /out:C:\jicate-ai\claude-acct.exe C:\jicate-ai\claude-acct-launcher.cs
     node -e "require('child_process').execFile('C:\\jicate-ai\\claude-acct.exe',['--version'],(e,o)=>console.log(e?'FAIL '+e.code:'OK '+o))"
   OK -> SHIM = C:\jicate-ai\claude-acct.exe.
   (If node.exe is not in C:\Program Files\nodejs\, set CLAUDE_ACCT_NODE.)
   Fallback ONLY if csc.exe is missing: probe claude-acct.cmd the same way.
   Node 18.20.2+, 20.12.2+ and 22 refuse a .cmd without a shell (FAIL EINVAL);
   if it says OK, SHIM = C:\jicate-ai\claude-acct.cmd, and check no drain
   starts it with shell:true and job text in an argument.
5. Dry run, as the drains' Windows user (Admin), with CLAUDE_REAL_BIN set
   (the --allowedTools is needed: an unfenced run never gets a Tower key):
     echo say OK | <SHIM> -p --model haiku --allowedTools Read
   GATE: C:\jicate-ai\logs\claude-acct.log must show
     attempt=1 account=<a label, NOT own-sign-in> exit=0
   and AI Routines a "lane: ok" key fetch for maxlane-biometric. "own-sign-in"
   or a "tower: ..." / "fence: ..." line means the Tower was not used: stop and
   report. JICATE_AI_URL in the env file must be https:// (the shim refuses
   plain http except localhost, logged "tower: refused a non-https ...").
6. For each drain task, set (where the task gets its environment):
     CLAUDE_REAL_BIN = C:\Users\Admin\.local\bin\claude.exe   (the old CLAUDE_BIN)
     CLAUDE_BIN      = <SHIM>
   then restart the drain tasks (stop their node processes too).
   CLAUDE_REAL_BIN must be the real claude.exe, never the shim (it refuses to run itself).
7. Watch logs\claude-acct.log and the MyJKKN queue drain.

Undo (fastest first):
- Set CLAUDE_ACCT_OFF=1 for the drains (or delete maxlane-biometric.env): every
  run goes straight to the real claude on the box's own sign-in, as before.
- Put CLAUDE_BIN back to C:\Users\Admin\.local\bin\claude.exe and restart.
- Revoke the token: UPDATE ai_runner_tokens SET revoked_at = now()
  WHERE runner = 'maxlane-biometric';  (the shim then falls back to own sign-in)
  Revoking does NOT rotate keys already handed out: if the token may have
  leaked, also sign each account out at claude.ai and store fresh keys.

How it behaves:
- The prompt (stdin) is read whole first, so a refused run can be replayed.
  A drain that never writes or closes stdin is taken as "no stdin" after 3 s.
- Claude's output is held until the run ends; the drain sees ONLY the last
  run's output and exit code. A run counts as refused only when it FAILED
  (non-zero exit or is_error) with a limit or bad-key message.
- Each account is tried at most once per run; then the box's own sign-in once.
- The Tower remembers a refusal for 30 minutes for every lane, so later jobs do
  not each spend a failed run on the same account. Order: priority list under
  95% (fresh readings first), then accounts above 95% (used to the real limit).
- The key is put only in the child claude's environment: never on disk, never
  on a command line, never in the log.
- Only fenced runs get a key (install step 1). Unfenced runs, and every run
  when the Tower URL is not https, go on the box's own sign-in as before.

Risks to know:
- A lane token can still fetch the key of EVERY stored account, one at a time:
  get a key, report it refused, get the next. The Tower accepts refused= only
  for an account it handed THAT lane in the last 30 minutes (else 400
  REFUSED_NOT_HANDED, logged "lane: refused label not handed to this lane"),
  so a holder cannot jump to a chosen account or bench accounts it never got;
  but each step it does take benches that account for every lane for 30 min.
  Only the rate limit (120/min, 60 rolls per 10 min), the log on AI Routines
  and revoking the token limit that. Keep maxlane-biometric.env readable by the
  box user only (new-runner-token.ps1 does this).
  Follow-up (not in this PR): a cap on distinct accounts handed per token per
  hour, with an alert; the number needs the Box desk / W12 to agree it.
- The token is not tied to one machine: ai_runner_tokens has no host column
  and ?host= is self-reported, log only. Follow-up: add a host binding.
- A drain's timeout kills what it started (cmd.exe or claude-acct.exe), not the
  shim's node or the claude.exe under it. The shim checks every 2 s whether
  that parent is gone and then stops claude (taskkill /T /F). Proven on a Mac
  only; on the box, after a drain timeout, check no stray claude.exe is left.
- 14 drains share one token's 120 asks a minute; past that a run gets 429 and
  falls back to the box's own sign-in (logged as "tower: tower 429").
- Every Claude run adds one row to ai_account_key_fetches; nothing prunes it.
  Follow-up (needs a migration and the Director's yes, so not in this PR):
  add "DELETE FROM ai_account_key_fetches WHERE fetched_at < now() - 90 days"
  to fn_ai_engine_prune, which the dispatcher already runs. The ownership
  check only reads the last 30 minutes, so pruning older rows is safe.
- The box agent may also set CLAUDE_CODE_OAUTH_TOKEN for the whole box. For a
  run through the shim, the Tower's lane key wins (set in the child last); when
  the Tower is unreachable, the box agent's key (or the own sign-in) applies.
- The lane's usage is still not reported to the Tower's readings; the Tower
  learns an account is spent only when a lane reports a refusal.
