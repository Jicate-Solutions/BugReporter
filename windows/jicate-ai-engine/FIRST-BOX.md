JICATE AI workers on the FIRST Windows box (BIOMETRIC) - install
================================================================

Director, 2026-10-19: JICATE's AI workers run on BOTH Windows boxes. This box
gets two JICATE workers, jicate-3 and jicate-4, on their OWN extra Claude
account, so they never use up the limit MyJKKN's workers need.

WAIT: install only after at least one extra account is saved on this box
(ACCOUNTS.md). Every box shares aicse today, so workers on "default" here would
add no capacity and would compete with MyJKKN's helpers.

DO NOT touch, stop or change any MyJKKN worker, task, folder or file. Everything
here lives in C:\jicate-ai\ and in tasks named ai.jicate.engine-3 / -4.
Install only on the Director's yes typed in this box's tab.

Files (from the Mac tab's temporary link), all into C:\jicate-ai\:
  jicate-ai-drain.mjs, run-jicate-ai-drain.cmd, new-runner-token.ps1,
  save-claude-account.mjs, ai.jicate.engine-3.xml, ai.jicate.engine-4.xml
Check every SHA-256 against the list the Mac tab sends. Stop if any differs.

1. Folders. If C:\jicate-ai\ already exists, stop and report what is in it.
   Otherwise create C:\jicate-ai\ and C:\jicate-ai\sandbox\. There must be no
   CLAUDE.md and no .claude folder in C:\ or C:\jicate-ai\.
2. Paths. In run-jicate-ai-drain.cmd replace __CLAUDE_EXE__ with the full path
   of claude.exe and __NODE_EXE__ with the full path of node.exe.
3. Self-test on this box's own sign-in (no server needed), in C:\jicate-ai\:
     set SELFTEST=1
     set CLAUDE_BIN=<claude.exe path>
     node jicate-ai-drain.mjs
   Expect SELFTEST answer="pong". Close that window afterwards.
4. The extra Claude account (the Director does this part himself):
   a. In a normal PowerShell window, NOT a Claude tab:  claude setup-token
      Sign in to the EXTRA Claude account in the browser, copy the key it prints.
   b. In C:\jicate-ai\:  node save-claude-account.mjs acct1
      Paste the key (hidden), Enter. Expect: account=acct1 saved and works
   The key stays in C:\jicate-ai\accounts\acct1.token, locked to this
   Windows user. Never open, print or send it.
5. Worker keys:
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner jicate-3
     powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner jicate-4
   Each prints runner=jicate-N sha256=<64 hex>. Send ONLY those two lines to the
   Mac tab through the mailbox: node C:\jicate-mail\jicate-mail.mjs send mac "<lines>"
   Wait for the Mac tab to say both are registered.
6. Tasks (no at-logon trigger, so no admin needed):
     schtasks.exe /create /tn "ai.jicate.engine-3" /xml C:\jicate-ai\ai.jicate.engine-3.xml /f
     schtasks.exe /create /tn "ai.jicate.engine-4" /xml C:\jicate-ai\ai.jicate.engine-4.xml /f
     schtasks.exe /run /tn "ai.jicate.engine-3"
     schtasks.exe /run /tn "ai.jicate.engine-4"
7. Logs C:\jicate-ai\logs\jicate-3.log and jicate-4.log should show
   "start runner=jicate-N", then "alive ok" each minute. Each claim tells the
   Control Tower the worker holds account acct1; the Mac tab then sets both
   workers to use acct1. Claimed jobs log "account=acct1".
8. Kill-test: stop only the node.exe processes whose command line contains
   jicate-ai-drain AND jicate-3 or jicate-4 (never MyJKKN's); each must come
   back with a new start line within about 60-90 s.
9. Report through the mailbox: self-test line, save-account line, task names,
   kill-test times, last 3 lines of each log. No secrets.

Rollback:
  schtasks.exe /end /tn "ai.jicate.engine-3" & schtasks.exe /delete /tn "ai.jicate.engine-3" /f
  schtasks.exe /end /tn "ai.jicate.engine-4" & schtasks.exe /delete /tn "ai.jicate.engine-4" /f
