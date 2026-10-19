@echo off
REM JICATE AI engine drain - Windows wrapper. One argument: the runner name (jicate-1, jicate-2, ...).
REM Reads JICATE_AI_URL and JICATE_AI_RUNNER_TOKEN from <runner>.env next to this file,
REM never from the task XML. No database key exists on this box.
set "HERE=%~dp0"
set "RUNNER=%~1"
if "%RUNNER%"=="" set "RUNNER=jicate-1"
set "ENV_FILE=%HERE%%RUNNER%.env"
set "SANDBOX=C:\jicate-ai\sandbox\%RUNNER%"
set "IDLE_MS=3000"
REM Absolute paths: bare "claude" / "node" do not resolve under Task Scheduler.
set "CLAUDE_BIN=__CLAUDE_EXE__"
set "NODE_BIN=__NODE_EXE__"
if not exist "%HERE%logs" mkdir "%HERE%logs"
"%NODE_BIN%" "%HERE%jicate-ai-drain.mjs" >> "%HERE%logs\%RUNNER%.log" 2>&1
