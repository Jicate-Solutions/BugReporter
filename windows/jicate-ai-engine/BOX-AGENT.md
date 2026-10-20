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
Risk the Director accepted: the key sits in HKCU\Environment, readable by
anything running as this Windows user (same as the worker .env files).

Files into C:\jicate-ai\ (check every SHA-256 the Mac tab sends):
  jicate-box-agent.mjs, run-jicate-box-agent.cmd, ai.jicate.box-agent.xml
  (new-runner-token.ps1 is already there from the worker install)

0. PROBE FIRST (skip if already done on this box): a task started by Task
   Scheduler must see a fresh setx value. If the probe printed the literal
   %VAR% or nothing, STOP and report: this design cannot work here.
1. In run-jicate-box-agent.cmd replace __NODE_EXE__ with the full path of node.exe.
2. Agent key (prints only a fingerprint; the secret stays in box-agent.env):
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner box-agent
   Send the Mac (mailbox) the printed line AND this box's hostname
   (node -e "console.log(require('os').hostname())"). Wait for "registered".
3. Restart list: write C:\jicate-ai\box-agent.json, e.g.
     { "restartTasks": ["ai.jicate.engine-1", "ai.jicate.engine-2", "<each MyJKKN worker task name>"] }
   List EVERY task whose Claude should follow the box account. Report which
   user each MyJKKN task runs as: a task running as SYSTEM or another user
   will NOT see this user's environment variable.
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
