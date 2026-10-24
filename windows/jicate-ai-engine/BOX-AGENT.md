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
4. Register and start (no admin: no any-user logon trigger):
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
