@echo off
REM BugReporter client triage drain - Windows wrapper.
REM Reads BUGREPORTER_URL and TRIAGE_RUNNER_TOKEN from triage.env next to this
REM file (ENV_FILE), never from the task XML. No database key exists on this box.
set "HERE=%~dp0"
set "ENV_FILE=%HERE%triage.env"
set "SANDBOX=C:\jkkn\bugreporter-triage-sandbox"
set "IDLE_MS=15000"
set "RUNNER=windows-triage"
REM If claude is not on PATH for cmd.exe, uncomment and point at the same binary the other drains use:
REM set "CLAUDE_BIN=C:\full\path\to\claude.exe"
if not exist "%HERE%logs" mkdir "%HERE%logs"
node "%HERE%bugreporter-triage-drain.mjs" >> "%HERE%logs\triage-drain.log" 2>&1
