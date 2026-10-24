JICATE box account agent - install on one Windows box
=====================================================

Director, 2026-10-20: switch the WHOLE box's Claude account from the Control
Tower (AI Routines -> Claude accounts -> the box's row -> Switch box), including
"auto (priority list)". After this install, later switches happen WITHOUT a
new approval on this box: the agent sets the account and restarts the tasks
listed in box-agent.json. Install only on the Director's yes typed in this tab.

What it changes on a switch:
- user environment variable CLAUDE_CODE_OAUTH_TOKEN (set to that account's
  key, or removed for "the box's own sign-in"). Every newly started Claude on
  this box uses it: MyJKKN's workers, JICATE workers, new Claude tabs.
- restarts each task in box-agent.json "restartTasks" (end, then run).
- Claude tabs already open keep their account until closed and reopened.
Risk the Director accepted, in the Mac tab on 2026-10-20 ("Key on box: switch
everything"): the key sits in HKCU\Environment, readable by anything running
as this Windows user. A box tab that was told "label only" must hear this
change from the Director in ITS OWN tab before installing.

Files into C:\jicate-ai\ (check every SHA-256 the Mac tab sends):
  jicate-box-agent.mjs, run-jicate-box-agent.cmd, ai.jicate.box-agent.xml
  (new-runner-token.ps1 is already there from the worker install)

0. PROBE FIRST (skip if already done on this box): a task started by Task
   Scheduler must see a fresh setx value. If the probe printed the literal
   %VAR% or nothing, STOP and report: this design cannot work here.
   (win-ai, 2026-10-20: PASSED. A /run task saw the fresh value; an already
   running process and its children did not, so workers MUST be stopped.)
1. In run-jicate-box-agent.cmd replace __NODE_EXE__ with the full path of node.exe.
2. Agent key (prints only a fingerprint; the secret stays in box-agent.env):
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner box-agent
   Send the Mac (mailbox) the printed line AND this box's hostname
   (node -e "console.log(require('os').hostname())"). Wait for "registered".
3. Restart list: write C:\jicate-ai\box-agent.json, e.g.
     { "restartTasks": [
         { "task": "ai.jicate.engine-1", "match": "jicate-ai-drain.mjs" },
         { "task": "ai.jicate.engine-2", "match": "jicate-ai-drain.mjs" },
         { "task": "<MyJKKN worker task>", "match": "<text unique to its command line>" } ] }
   List EVERY task whose Claude should follow the box account. "match" makes
   the agent also stop the long-running process that task started (ending a
   task does not stop its node child, and a child keeps the OLD account). The
   match text must not match the agent itself. Report which user each MyJKKN
   task runs as: a task running as SYSTEM or another user will NOT see this
   user's environment variable.
4. Register and start (no any-user logon trigger; since 2026-10-24 the XML
   asks for RunLevel HighestAvailable, so register it from an elevated
   prompt - see "Commands, status reports and self-update" below):
     schtasks.exe /create /tn "ai.jicate.box-agent" /xml C:\jicate-ai\ai.jicate.box-agent.xml /f
     schtasks.exe /run /tn "ai.jicate.box-agent"
5. Log C:\jicate-ai\logs\box-agent.log shows "start host-agent ... restartTasks=N".
   The AI Routines page shows "agent seen ..." on this box's row.
6. Report the log line, the restart list and the task users through the mailbox.

Rollback:
  schtasks.exe /end /tn "ai.jicate.box-agent" & schtasks.exe /delete /tn "ai.jicate.box-agent" /f
  reg delete HKCU\Environment /v CLAUDE_CODE_OAUTH_TOKEN /f
  (then restart the listed tasks so they return to the box's own sign-in)

File updates (2026-10-24)
-------------------------
Why: on a box where the workers run as S4U tasks (session 0), a Claude tab
cannot stop or restart them without Windows admin, so every worker update cost
a UAC click. The agent runs as the same user and already restarts them, so it
installs new worker files itself. Only jicate-ai-drain.mjs; never itself.

One-time, on the Mac (Box desk):
  node windows/jicate-ai-engine/sign-box-file.mjs --keygen
  - writes ~/.jicate-mail/box-update-signing.pem (0600; never print, never
    commit) and prints ONLY the public key.
On each box, add that public key to C:\jicate-ai\box-agent.json:
  { "restartTasks": [ ... ], "updatePublicKey": "<printed base64>" }
copy the new jicate-box-agent.mjs in (check its SHA-256), and restart the
agent task. Its log says "fileUpdates=on". Without the key the agent never
applies a file update.

To publish a worker update (Box desk, after the change is merged):
  node windows/jicate-ai-engine/sign-box-file.mjs windows/jicate-ai-engine/jicate-ai-drain.mjs
  -> {"name":"jicate-ai-drain.mjs","sha256":"...","signature":"..."}
  Upsert ONE row into public.ai_box_files with the service role:
    name, sha256, signature (from the line above), content = the file's exact
    text, source = the commit sha, updated_at = now().
  sha256 is of the exact file bytes (shasum -a 256), not a git blob sha.
  Only the service role can write this table; the agent token can only read.

What each box agent then does (within a minute or two):
  1. downloads the file, checks sha256 twice (listed vs. received bytes) and
     the Ed25519 signature, writes jicate-ai-drain.new.mjs, runs node --check;
  2. waits until none of its JICATE workers is mid-job (up to 10 minutes);
  3. keeps the old file as jicate-ai-drain.mjs.bak-<old sha8>, swaps, and
     restarts ONLY the JICATE worker tasks in box-agent.json (entries whose
     "match" contains jicate-ai-drain.mjs, or task ai.jicate.engine-*).
     MyJKKN helpers on the same list are NOT restarted by a file update (their
     jobs are invisible to "busy"); account switches still restart the whole
     list. Log: "file updated jicate-ai-drain.mjs <old8> -> <new8>; restarted
     N task(s)";
  4. health check: every worker of the box seen in the 5 minutes before the
     swap must check in again within 3 minutes (if none was active, at least
     one must). If not, it restores the backup, restarts the workers again,
     never retries that sha, and logs it. The swap is recorded before the
     rename, so an agent stopped mid-swap finishes the restart and the check
     on its next run.
  5. only then reports the sha it runs: ai_boxes.files_applied.
A box missing the file is skipped (the agent never creates it). A rejected
sha is remembered in box-agent.files.json; publish a new sha to try again.
files_applied stays empty on a box until its first file update or account
switch.

Downgrade risk (accepted, low): the signature proves the Box desk signed the
file, not that it is the newest. Someone with database write access could
republish an OLDER validly signed jicate-ai-drain.mjs and the boxes would
install it. That is still code the Box desk approved, and the health check
still applies. Check source (commit sha) in ai_box_files if in doubt.

If the signing key leaks (or the Mac is lost):
  1. Move the old key aside on the Mac, then make a new one:
       mv ~/.jicate-mail/box-update-signing.pem ~/.jicate-mail/box-update-signing.pem.revoked
       node windows/jicate-ai-engine/sign-box-file.mjs --keygen
  2. On EACH box, replace "updatePublicKey" in C:\jicate-ai\box-agent.json
     with the new printed public key and restart the agent task
     (schtasks.exe /end then /run /tn "ai.jicate.box-agent"). From then on
     files signed with the old key are rejected on that box.
  3. Re-sign and republish the current worker (new signature, same sha is
     fine; a box already on that sha does nothing).
  Until step 2 is done on a box, the leaked key plus database write access
  can still install code there, so do step 2 on every box right away.

If an update is refused because no task in restartTasks matches the worker file, the agent remembers that sha as failed in `box-agent.files.json`. After fixing restartTasks, remove that entry (or the file) and restart the agent so the update is tried again.

Remote control from the Tower
-----------------------------
(2026-10-24, Tower side: migration 20261024_box_remote_control.sql, the
box-agent route, box-command.mjs, sign-box-file.mjs --publish.)

After one last install per box, the Mac changes a box only through signed rows
in the Control Tower. The box agent picks them up on its normal poll. No Claude
tab, no paste, no UAC click.

Commands (public.ai_box_commands, one row per command for one box):
  status          {}                         the agent's full status report
  restart-task    {"task"}                   only a task in box-agent.json
                                             restartTasks; never the agent's own
  register-task   {"task","xml"}             schtasks /create from an installed,
                                             sha-checked task XML (agent elevated)
  run-script      {"shell":"powershell"|"cmd","content_b64","timeout_s"<=600}
                                             the script is inside the signed bytes
  A row's payload is the exact signed text {id, box, verb, args, expires_at}
  (keys in that order), signed with the same Ed25519 key as ai_box_files.
  The box trusts only that payload and refuses (status 'refused', with a
  reason) a bad signature, an id or box that does not match, an expired
  command, an unknown verb, or an id it has already run.
  Expiry: 30 minutes by default, at most 5h55m from box-command.mjs. The
  table refuses more than 6 hours after its own clock; the 5 minutes spare
  keep a Mac clock that differs from the database clock from tripping that.
  A row still 'running' 15 minutes after its expiry is marked 'failed'
  (result {"reason":"agent stopped"}) when its box next asks, so a dead
  agent cannot leave it running forever. States: queued -> running -> done | failed | refused, or
  queued -> expired when the box asks after expires_at. A finished row never
  moves again. A command for a box that has never checked in simply waits
  (or expires).

What the box sees (GET /api/internal/ai-engine/box-agent, its own token):
  commands: up to 5 of ITS OWN queued, unexpired rows, oldest first, as
  [{ id, verb, payload, signature }]. Its own stale queued rows are marked
  expired first.
What the box sends back (POST, any combination):
  command_update { id, status: running|done|failed|refused, result? } - only
    its own rows; the answer says { command: { id, moved } }, moved false
    when the row was already finished or is not this box's.
  status_report { ... } - stored in ai_boxes.status_report with status_at
    (every 5 minutes and on a `status` command; super admins can read it).
  `applied` is now optional: a POST without it does not touch the box's
  account. result and status_report are each limited to 128 KB of JSON.

Sending a command from the Mac:
  node windows/jicate-ai-engine/box-command.mjs <box> <verb> [json-args] [--expires 30m] [--wait]
    e.g.  ... box-command.mjs WIN-AI status --wait
          ... box-command.mjs WIN-AI restart-task '{"task":"ai.jicate.engine-1"}'
          ... box-command.mjs WIN-AI register-task '{"task":"ai.jicate.engine-1","xml":"ai.jicate.engine-1.xml"}'
          ... box-command.mjs WIN-AI run-script '{"shell":"powershell","timeout_s":60}' --script check.ps1 --wait
  <box> is the host exactly as in ai_boxes.host. It signs with
  ~/.jicate-mail/box-update-signing.pem, inserts one row through the Supabase
  Management API (token from ~/.supabase/access-token, never printed) and,
  with --wait, prints the result when the box finishes (exit 0 = done).
  --dry-run prints the signed row and the SQL and touches nothing.

Publishing a file (now any of the ten allow-listed names):
  node windows/jicate-ai-engine/sign-box-file.mjs <file> --publish
  signs it and upserts the ai_box_files row (content, sha256, signature,
  source = the commit sha; the file must be committed). Task XMLs (*.xml)
  must be UTF-16LE with a BOM, as Windows writes them: content, sha256 and
  signature are over the UTF-8 text, and the agent writes the file back as
  BOM + UTF-16LE (the XML declares encoding="UTF-16").

Commands, status reports and self-update
----------------------------------------
(2026-10-24, box side: jicate-box-agent.mjs, run-jicate-box-agent.cmd,
ai.jicate.box-agent.xml. The Tower side is the section above.)

THE ONE REMAINING INSTALL PER BOX. After it, every change to the box goes
through the Tower (no Claude tab, no paste, no UAC click) - except the
launcher, run-jicate-box-agent.cmd, which stays install-by-hand only (see
"The launcher" below). Do it only on the Director's yes typed in that box's
own tab.
  1. Copy into C:\jicate-ai\ (check each SHA-256 the Mac sends):
       jicate-box-agent.mjs, run-jicate-box-agent.cmd, ai.jicate.box-agent.xml
  2. In run-jicate-box-agent.cmd replace __NODE_EXE__ with the full path of
     node.exe (as before). Keep it CRLF.
  3. Optional, in box-agent.json:
       "mailClientPath": "<full path>\\jicate-mail.mjs"   where the mail client lives
       "costLog": "logs\\jicate-1.log" (or a list)       for the 7-day API cost sum
       "box": "<name>"   only if ai_boxes.host is not this PC's hostname
  4. From an ELEVATED prompt (Box 2: this is the last UAC click):
       schtasks.exe /end /tn "ai.jicate.box-agent"
       schtasks.exe /create /tn "ai.jicate.box-agent" /xml C:\jicate-ai\ai.jicate.box-agent.xml /f
       schtasks.exe /run /tn "ai.jicate.box-agent"
     The XML now says RunLevel HighestAvailable: the agent runs with the
     highest rights this Windows user has, so register-task and admin
     scripts need no UAC click. If the user is not an administrator,
     HighestAvailable is just normal rights; register-task then fails with
     "needs admin; register once by hand" and is never retried.
  5. The log shows "start host-agent ... commands=on box=<name> sha=<8>", and
     `box-command.mjs <box> status --wait` on the Mac prints the report.
  Without the new launcher (step 1), a staged agent is never installed: the
  agent logs "run-jicate-box-agent.cmd does not install staged files; install
  the new launcher by hand" and keeps running the old file.

Box 2 registers its worker tasks as S4U ("run whether the user is logged on
or not", no stored password; the PC signs in automatically). Registering an
S4U task needs admin, which is why the agent runs elevated. The repo's
ai.jicate.engine-*.xml say InteractiveToken: do NOT register them on Box 2
as they are. First read Box 2's own XML (it is in every status report, or
run-script: schtasks /query /tn <task> /xml), commit it as the task XML,
publish that, then register-task.

What the agent does each minute, in this order:
  1. account switch (unchanged);
  2. file updates (one file per minute; see below);
  3. commands, in the background: the minute loop never waits for them;
  4. a status report every 5 minutes, also in the background.
A failing command or report never stops steps 1 and 2.

Commands. Checked as the section above says: signature over the exact
payload text (before it is parsed), id = row id, box = this box (ai_boxes.host
or box-agent.json "box", any letter case), expires_at against the Tower's
clock, at most 6 hours ahead, known verb, id not in the ledger. The ledger is
C:\jicate-ai\box-agent.commands.json (no secrets). A command is written to it
BEFORE it runs, and runs only after the Tower accepted 'running' (moved:
false = the row is already closed there, so it is not run). If the agent
stops mid-command, the next start reports it 'failed' ("the box agent stopped
while this command was running") and never runs it again. A result the Tower
did not get is sent again each minute; moved: false on it is logged and
dropped (e.g. the Tower already marked it "agent stopped").
  status          the status report below; also stored as ai_boxes.status_report.
  restart-task    only a task named in restartTasks, never the agent's own
                  (ai.jicate.box-agent, or box-agent.json "agentTask"). Tasks
                  that share its "match" restart with it, because stopping the
                  match stops their processes too. When a JICATE worker task is
                  in the restart, it first waits until the Tower says no JICATE
                  job runs on this box, for up to 10 polls (about 10 minutes),
                  like an account switch, then restarts anyway. "busy" is
                  box-wide: the Tower does not know which worker a task runs.
                  {"task": ..., "force": true} restarts at once. MyJKKN jobs are
                  not visible to the Tower, so a MyJKKN task is never waited for.
                  The wait runs in the background; the result says forced,
                  waited_s and busy_at_restart.
  register-task   xml = one of the four ai.jicate.engine-*.xml, installed by
                  this agent from a signed row, unchanged on disk since, and
                  the version the Tower lists now. Handed to schtasks as
                  UTF-16. Never the agent's own task (ai.jicate.box-agent,
                  "agentTask", any name containing box-agent) or
                  ai.jicate.box-agent.xml: refused with "agent's own task:
                  register by hand once with the Director watching". Access
                  denied -> 'failed', "needs admin; register once by hand";
                  never retried.
  run-script      powershell (-NoProfile -ExecutionPolicy Bypass -File) or cmd
                  (/d /c), its own hidden child process, as this user at the
                  agent's run level. timeout_s 1-600 (default 300); on timeout
                  the whole process tree is killed. Result: exit_code,
                  timed_out, seconds and the last 4 KB of stdout+stderr. The
                  script text is never logged; its temp file in
                  C:\jicate-ai\scripts is deleted afterwards.
  Own time limits: status 120 s, restart-task 15 min (wait included),
  register-task 90 s.

Status report (every 5 minutes, time kept in box-agent.commands.json, and on
a status command): host, box, agent sha, node version, claude --version,
Windows uptime, free GB on C:, each restartTasks task's state / last run /
last result / run-as user (schtasks /query /v, English Windows labels) and
its full task XML (schtasks /query /xml, trimmed and scrubbed, up to 4 KB),
the agent task's RunLevel, LogonType and task XML, the sha of every
allow-listed file on disk (plus the published sha when the file was adapted
for this box), staged .new files, a file update awaiting its health check,
failed shas, running commands, box-agent.json with every key that looks
secret (token, key, secret, password, credential, auth) replaced by
[redacted] and the public key shown only as a fingerprint, the last 20 lines
of logs\box-agent.log (each scrubbed: key=value secrets, bearer tokens,
sk-ant-..., and any run of 32+ base64/hex characters become [redacted]), and
the 7-day api_cost_usd sum from "costLog". Kept under 100 KB (the Tower takes
up to 128 KB): the oldest log lines go first, then the task XML.

File updates by name (signature + sha checks exactly as in "File updates"):
  jicate-ai-drain.mjs       unchanged: swap when idle, restart the JICATE
                            workers, health check, restore on failure.
  run-jicate-ai-drain.cmd   the same path (no node --check). Refused unless every
                            line ends in CRLF (sign-box-file.mjs refuses to sign
                            it otherwise too). Its __CLAUDE_EXE__ and
                            __NODE_EXE__ take the values the live file has; if
                            one is missing it is not installed. Installed only
                            when the workers are idle, then they are restarted:
                            a launcher swapped under a running cmd.exe would be
                            read from the wrong byte offset when node exits.
  jicate-box-agent.mjs      staged as jicate-box-agent.mjs.new (after
                            node --check on a .mjs copy); never overwritten live.
  run-jicate-box-agent.cmd  NEVER installed by the agent, even if the Tower lists
                            it: logged once as "launcher is install-by-hand
                            only". Its sha on disk is still reported.
  jicate-mail.mjs           installed at "mailClientPath" after node --check
                            (skipped, with one log line, if that is not set).
  ai.jicate.*.xml           installed in C:\jicate-ai\ as BOM + UTF-16LE.
  A replaced file is kept as <name>.bak-<old sha8>. A file adapted for this
  box (XML as UTF-16, a launcher with this box's paths) differs from the
  published bytes; files_applied reports the published sha as long as the file
  on disk is exactly what the agent wrote (box-agent.files.json "known"),
  otherwise the sha of what is on disk.

Self-update of the agent:
  1. After staging jicate-box-agent.mjs.new, the agent exits as soon as
     nothing is in progress (no account restart owed, no file swap, no
     command running). Task Scheduler starts the launcher again within a
     minute.
  2. At start, the launcher checks the staged agent with node --check (on a
     .mjs copy: node will not parse a .new file as ESM), keeps the current one
     as jicate-box-agent.mjs.bak-<yyyyMMdd-HHmmss>, moves the new one in and
     writes jicate-box-agent.swapped. A failed check renames it to
     jicate-box-agent.mjs.rejected; the agent then never tries that sha again.
  3. The new agent deletes jicate-box-agent.swapped once it has reached the
     Tower. If it has not reached the Tower within 3 minutes of starting, it
     exits with an error. At the next launcher start (within a minute) the
     marker is still there, so the launcher restores the backup and keeps the
     new one as .rejected. (Chosen over an ExecutionTimeLimit on the task:
     the agent is meant to run for ever, so a time limit would also stop a
     healthy agent.) A network outage right after a swap therefore also rolls
     back. The old agent keeps working, but that sha is now marked failed on
     that box for good: nothing retries it by itself.
  To retry a rejected sha (it will NOT happen on its own): either publish a
  new sha (any trivial edit, re-signed), or send a run-script that deletes
  the .rejected file and removes that sha from box-agent.files.json "failed".

The launcher (run-jicate-box-agent.cmd) is install-by-hand only. A bad
launcher would stop the agent from starting every minute, with nothing left
on the box to fix it from the Tower, so it is not a published update even
though its name is on the Tower's allow-list. To change it: copy it in by
hand (fill __NODE_EXE__, keep CRLF) on the Director's yes in that box's tab.
