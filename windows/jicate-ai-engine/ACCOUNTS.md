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
  claude-acct.cmd            wrapper, IF the drains can start a .cmd (step 0)
  claude-acct-launcher.cs    source of claude-acct.exe, for when they cannot
Tower side: GET /api/internal/ai-engine/lane-key (merged PR; see its header).

Install (after the PR is merged and live; only on the Director's yes):
0. PROBE: can the drains start a .cmd? The drains call execFile(CLAUDE_BIN, ...)
   with no shell; Node 18.20.2+, 20.12.2+ and 22 refuse a .cmd that way (EINVAL).
   In C:\jicate-ai\ (after step 2):
     node -e "require('child_process').execFile('C:\\jicate-ai\\claude-acct.cmd',['--version'],(e,o)=>console.log(e?'FAIL '+e.code:'OK '+o))"
   OK -> use claude-acct.cmd in step 4. FAIL EINVAL -> build the .exe:
     C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /out:C:\jicate-ai\claude-acct.exe C:\jicate-ai\claude-acct-launcher.cs
   and repeat the probe with claude-acct.exe; use that in step 4.
   (If node.exe is not in C:\Program Files\nodejs\, set CLAUDE_ACCT_NODE.)
1. Lane token, made ON the box (prints only a hash; secret stays in the file):
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner maxlane-biometric
   Send the printed "runner=maxlane-biometric sha256=..." line to the Box desk.
   The Box desk inserts it into ai_runner_tokens (runner maxlane-biometric).
   The name MUST start with "maxlane-": only such tokens open /lane-key, and
   they cannot claim or answer JICATE jobs.
2. Copy claude-acct.mjs (+ .cmd or .cs) into C:\jicate-ai\ and check SHA-256s.
   In claude-acct.cmd replace __NODE_EXE__ with the full path of node.exe.
3. Dry run, as the drains' Windows user (Admin):
     echo say OK | C:\jicate-ai\claude-acct.cmd -p --model haiku
   Expect "OK"; C:\jicate-ai\logs\claude-acct.log gets
     attempt=1 account=<label> exit=0
   and AI Routines shows a "lane: ok" key fetch for maxlane-biometric.
4. For each drain task, set (where the task gets its environment):
     CLAUDE_REAL_BIN = C:\Users\Admin\.local\bin\claude.exe   (the old CLAUDE_BIN)
     CLAUDE_BIN      = C:\jicate-ai\claude-acct.cmd           (or claude-acct.exe)
   then restart the drain tasks (stop their node processes too).
   CLAUDE_REAL_BIN must be the real claude.exe, never the shim (it refuses to run itself).
5. Watch logs\claude-acct.log and the MyJKKN queue drain.

Undo (fastest first):
- Set CLAUDE_ACCT_OFF=1 for the drains (or delete maxlane-biometric.env): every
  run goes straight to the real claude on the box's own sign-in, as before.
- Put CLAUDE_BIN back to C:\Users\Admin\.local\bin\claude.exe and restart.
- Revoke the token: UPDATE ai_runner_tokens SET revoked_at = now()
  WHERE runner = 'maxlane-biometric';  (the shim then falls back to own sign-in)

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

Risks to know:
- A lane token can fetch the key of EVERY stored account (refused= walks the
  list), with no running job needed; only the rate limit (120/min, 60 rolls per
  10 min), the log on AI Routines and revoking the token limit that. Keep
  maxlane-biometric.env readable by the box user only (new-runner-token.ps1
  does this).
- If a drain kills the shim on its timeout, Windows does not stop the claude.exe
  it started; that run finishes (or hangs) on its own. Watch for stray claude.exe.
- The box agent may also set CLAUDE_CODE_OAUTH_TOKEN for the whole box. For a
  run through the shim, the Tower's lane key wins (set in the child last); when
  the Tower is unreachable, the box agent's key (or the own sign-in) applies.
- The lane's usage is still not reported to the Tower's readings; the Tower
  learns an account is spent only when a lane reports a refusal.
