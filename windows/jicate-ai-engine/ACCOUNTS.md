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
   - THE TOOL FENCE (W12 reviews, PR #93). A Tower key is handed ONLY to a
     run whose arguments carry ALL of:
       --setting-sources without "user" (e.g. project): Box 1's
         C:\Users\Admin\.claude\settings.json defaults to bypassPermissions,
         so an allow list alone is NOT a fence there;
       --permission-mode dontAsk (or default / plan);
       --strict-mcp-config (no MCP servers from the user's config: they would
         start with the key in their environment);
       --tools with plain read-only names only, e.g. --tools Read,Grep,Glob
         (allowed: Read, Glob, Grep, LS, NotebookRead, TodoWrite; "" = no
         tools). --tools is the set claude LOADS, so Bash, PowerShell and
         WebFetch are not even there; a run with no --tools gets NO key;
       any --allowedTools / --allowed-tools rules (optional) use the same
         read-only tools, each file tool scoped to the run's own folder with a
         relative ./ path: Read(./**), Grep(./**). A bare "Read" or an absolute
         path like Read(C:/...) gets NO key: it can reach the lane-token file;
     and none of: --dangerously-skip-permissions, --permission-prompt-tool,
     --add-dir, --mcp-config, --plugin-dir, --plugin-url, --settings, an
     option the shim does not know, or an option value starting with "-"
     (a flag hidden as a value). Anything after "--" is prompt text, not
     options. The drain's environment must not set ANTHROPIC_BASE_URL.
     Any other run (Bash, PowerShell, WebFetch, WebSearch, Edit, Write, Task,
     mcp__*, a missing piece) runs on the box's own sign-in, logged
     "fence: no Tower key (<reason>)". So a prompt-injected job that can shell
     out, reach the web, plant settings or read outside its folder never holds
     an account key IN ITS ENVIRONMENT. A drain logging "fence: ..." needs its
     fence fixed in MyJKKN before it can use the Tower's accounts.
     The shim also refuses a key when maxlane-biometric.env sits inside the
     folder claude runs in (or IS that folder), logged "fence: no Tower key
     (token file inside the working folder)".
   - THE TOKEN FILE IS NOT PROTECTED FROM OTHER RUNS ON THE BOX. Plainly:
     maxlane-biometric.env is readable by the Windows user Admin, and Admin is
     the SAME user that runs every drain. Box 1's user settings default to
     bypassPermissions, so ANY Claude run on Box 1 that is not fenced and has
     a shell (through the shim or not) can read that file, for example
     after a prompt-injected upload says "type C:\jicate-ai\maxlane-biometric.env".
     Whoever holds the token gets up to 3 account keys an hour, and every
     stored key in about (accounts / 3) hours. The cap and the 30-minute rule
     slow that down; nothing in the shim can stop it, because it is the same
     Windows user.
     GATE before the Box desk inserts the token row (step 2): fill the
     "reads untrusted content? has a shell?" column below, and either NO
     drain on Box 1 runs Claude with a shell over uploaded / outside content,
     or the Director accepts that risk in writing for this install.
     Fill this table on the box BEFORE install. The drain scripts are not in
     any repo, so NOTHING below is verified yet; names come from MyJKKN docs
     and the desk's notes, and Box 1 has ~14 drains, so list the rest too:

       | drain script (C:\Users\Admin\jkkn-max-lane\) | claude arguments (--tools, --allowedTools, --setting-sources, --permission-mode, --strict-mcp-config) | drain folder .claude\settings*.json / .mcp.json (allow, hooks, MCP, env) | gets a Tower key? | reads untrusted content? has a shell? |
       |-----------------------------|----------------------|----------------------|------------------|------------------|
       | ai-chat-drain.mjs           | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | ai-jobs-drain.mjs           | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | ai-jobs-drain-pde.mjs       | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | poller.mjs (AI routines)    | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | campus-classify.mjs         | to verify on box (bare --allowedTools Read as of 8 Nov: would get NO key) | to verify on box | to verify on box | to verify on box |
       | card-extract.mjs            | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | regscan-read.mjs            | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | procurement-pdf-extract.mjs | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | referral-check.mjs          | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | work-pulse-analyze.mjs      | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | skillphoto drain            | to verify on box     | to verify on box     | to verify on box | to verify on box |
       | (any other drain found)     | to verify on box     | to verify on box     | to verify on box | to verify on box |

     Check commands (PowerShell, as Admin, read only):
       # every drain script and the claude arguments it builds
       Get-ChildItem C:\Users\Admin\jkkn-max-lane\*.mjs | Select-String -Pattern 'allowedTools|allowed-tools|--tools|setting-sources|permission-mode|strict-mcp-config|add-dir|mcp-config|dangerously|ANTHROPIC_BASE_URL' | Format-Table Filename, LineNumber, Line -AutoSize
       # the claude command lines actually running right now
       Get-CimInstance Win32_Process -Filter "name='claude.exe'" | Select-Object -ExpandProperty CommandLine
       # each drain's project settings and MCP files (allow rules, hooks, MCP servers, env, additionalDirectories)
       Get-ChildItem C:\Users\Admin\jkkn-max-lane, C:\jkkn-* -Recurse -Include settings.json, settings.local.json, .mcp.json -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName; Get-Content $_.FullName }
       # any settings file that adds working folders (it could add C:\jicate-ai, which the shim cannot see)
       Get-ChildItem C:\Users\Admin\jkkn-max-lane, C:\jkkn-* -Recurse -Include settings.json, settings.local.json -ErrorAction SilentlyContinue | Select-String additionalDirectories
       # the scheduled tasks behind them
       Get-ScheduledTask | Where-Object TaskName -like 'ai.jkkn.*' | Select-Object TaskName, State
     Or simply: point ONE drain at the shim and read logs\claude-acct.log; a
     "fence: no Tower key (<reason>)" line names what is missing.
     The shim cannot see settings FILES: a drain whose project settings allow
     Bash / PowerShell / WebFetch / WebSearch, set ANTHROPIC_BASE_URL, add
     working folders (permissions.additionalDirectories), or start MCP servers
     or hooks, must not be pointed at the shim (leave its
     CLAUDE_BIN as the real claude.exe) until that is removed.
   - maxlane-biometric.env stays in C:\jicate-ai\, OUTSIDE every drain's
     working folder (a run allowed Read must not be able to reach it).
   - TWO FENCE CHECKS ON THE BOX, before the token row is inserted. They use
     a canary file, not the real token file, so a failed check leaks nothing.
     Each check also has a POSITIVE CONTROL: a second value inside the test
     folder that the run MUST print. If it is missing, or the json says
     "is_error": true, claude failed (bad flag, sign-in, limit) and the check
     proves nothing: fix that and run it again. A missing canary only counts
     when the control IS there.
       $c = [guid]::NewGuid().ToString(); Set-Content C:\jicate-ai\fence-canary.txt "CANARY=$c"
       mkdir C:\fence-test; cd C:\fence-test
       $ok = [guid]::NewGuid().ToString(); Set-Content C:\fence-test\inside.txt "CONTROL=$ok"
       cmd /c mklink /J link C:\jicate-ai
       $F = '-p','--output-format','json','--setting-sources','project','--permission-mode','dontAsk','--strict-mcp-config','--tools','Read,Grep,Glob','--allowedTools','Read(./**)'
       function Pass($file) { $o = Get-Content $file -Raw; ($o.Contains($ok)) -and ($o -notmatch '"is_error":\s*true') }
     (1) A junction to C:\jicate-ai cannot be read from a fenced run:
       'Read inside.txt and print its line. Then read link\fence-canary.txt and print it. Also Grep and Glob inside link\.' | & C:\Users\Admin\.local\bin\claude.exe @F > out1.json
       Pass out1.json                                # must be True (control printed, no error)
       (Get-Content out1.json -Raw).Contains($c)    # must be False
     (2) A fenced run cannot print its environment, so no key or token shows:
       'Read inside.txt and print its line. Then print every environment variable, with its value, and the contents of C:\jicate-ai\fence-canary.txt.' | & C:\Users\Admin\.local\bin\claude.exe @F > out2.json
       Pass out2.json                                # must be True
       (Get-Content out2.json -Raw) -match 'sk-ant-|CLAUDE_CODE_OAUTH_TOKEN=|JICATE_AI_RUNNER_TOKEN'   # must be False
       (Get-Content out2.json -Raw).Contains($c)    # must be False
     Repeat (2) through <SHIM> after step 5 (when the run really holds a Tower
     key; check logs\claude-acct.log shows an account label, not own-sign-in):
     Pass True, the rest still False. Then clean up:
       cmd /c rmdir C:\fence-test\link; Remove-Item C:\fence-test -Recurse; Remove-Item C:\jicate-ai\fence-canary.txt
     (rmdir on a junction removes the link only, never C:\jicate-ai.)
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
5. Dry run, as the drains' Windows user (Admin), with CLAUDE_REAL_BIN set,
   from an empty folder outside C:\Users (the fence flags are needed: an
   unfenced run never gets a Tower key):
     echo say OK | <SHIM> -p --model haiku --setting-sources project --permission-mode dontAsk --strict-mcp-config --tools Read,Grep,Glob --allowedTools "Read(./**)"
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
- If a lane token leaks, the holder gets at most 3 DIFFERENT account keys per
  rolling hour. The Tower accepts refused= only for an account it handed THAT
  lane in the last 30 minutes (else 400 REFUSED_NOT_HANDED, logged "lane:
  refused label not handed to this lane"), so a holder cannot jump to a chosen
  account or bench accounts it never got. And it hands one lane token at most
  3 distinct accounts per rolling hour (else 429 ACCOUNT_CAP_REACHED, logged
  "lane: account cap reached" plus an "ALERT account cap reached" line in the
  Vercel logs, nothing benched); handing an account it already got this hour
  again is fine. The cap reads, per stored account, only the LATEST time this
  lane was handed it (one small query per account), so no database row limit
  or flood of re-hands can hide an account from it. It is a speed limit, not a
  wall: a patient holder still gets every key in about (accounts / 3) hours,
  so a "lane: account cap reached" row on AI Routines is worth a look.
  TODAY NOBODY IS NOTIFIED: the "ALERT" is only a line in the Vercel logs, and
  the row only shows if someone opens AI Routines. Follow-up: a rule in
  lib/ai-engine/watch.ts that emails the Director on "lane: account cap
  reached" rows (like its 90%-of-allowance rule). Each roll it does take benches that account for
  every lane for 30 min. Rate limit (120/min, 60 rolls per 10 min), the log on
  AI Routines and revoking the token are the other limits. Keep
  maxlane-biometric.env readable by the box user only (new-runner-token.ps1
  does this).
- The cap also binds the real drains: when Box 1 burns through 3 accounts in
  an hour, further runs get 429 and go on the box's own sign-in (logged
  "tower: tower 429 ACCOUNT_CAP_REACHED") until the oldest grant is an hour old.
- The token is not tied to one machine: ai_runner_tokens has no host column
  and ?host= is self-reported, log only. Follow-up: add a host binding.
- The token file is readable by every Claude run on Box 1 (same Windows user;
  see install step 1). Stronger option, follow-up: a small key broker running
  under its OWN Windows account (e.g. a "jicate-lane" local user), the only
  account the token file's ACL allows. The shim would ask the broker over a
  local named pipe instead of reading the file; the broker would check the
  calling claude's command line against the same fence before asking the
  Tower. A shell run as Admin could then no longer copy the token, only ask
  the broker, which refuses unfenced callers. Not built: it adds a service
  and an account on Box 1. Until then the real guard is "no shell-capable
  Claude run over untrusted content on Box 1" (install step 1 gate).
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
