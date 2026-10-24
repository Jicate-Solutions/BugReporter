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
  3. keeps the old file as jicate-ai-drain.mjs.bak-<old sha8>, swaps, restarts
     the tasks in box-agent.json; log: "file updated jicate-ai-drain.mjs
     <old8> -> <new8>; restarted N task(s)";
  4. health check: every worker of the box seen in the 5 minutes before the
     swap must check in again within 3 minutes. If not, it restores the
     backup, restarts again, never retries that sha, and logs it.
  5. only then reports the sha it runs: ai_boxes.files_applied.
A box missing the file is skipped (the agent never creates it). A rejected
sha is remembered in box-agent.files.json; publish a new sha to try again.
files_applied stays empty on a box until its first file update or account
switch.
