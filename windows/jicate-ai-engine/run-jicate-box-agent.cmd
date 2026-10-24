@echo off
REM JICATE box account agent - Windows wrapper. Reads box-agent.env next to this file.
REM
REM This launcher is install-by-hand only: the agent never installs or replaces it
REM (a bad launcher would stop the agent every minute with no way back).
REM
REM Staged agent update (2026-10-24). The agent never overwrites its own file: it
REM writes jicate-box-agent.mjs.new, then exits when idle, and Task Scheduler starts
REM this launcher again within a minute.
REM  - At start, a staged agent is checked with node --check (on a .mjs copy, since
REM    node will not parse a .new file as ESM), the current one is kept as
REM    jicate-box-agent.mjs.bak-<stamp>, then the staged one is moved in. A failed
REM    check renames it to jicate-box-agent.mjs.rejected (the agent then never
REM    tries that sha again).
REM  - jicate-box-agent.swapped names the backup until the new agent reaches the
REM    Tower (the agent deletes it). A new agent that cannot reach the Tower within
REM    3 minutes exits with an error. If the marker is still here at the next start,
REM    the backup is restored and the new one kept as jicate-box-agent.mjs.rejected.
setlocal
set "HERE=%~dp0"
REM Absolute path: bare "node" does not resolve under Task Scheduler.
set "NODE_BIN=__NODE_EXE__"
set "AGENT=%HERE%jicate-box-agent.mjs"
set "LOG=%HERE%logs\box-agent.log"
if not exist "%HERE%logs" mkdir "%HERE%logs"
if exist "%HERE%jicate-box-agent.swapped" call :rollback
if exist "%HERE%jicate-box-agent.mjs.new" call :swapagent
"%NODE_BIN%" "%AGENT%" >> "%LOG%" 2>&1
exit /b

:rollback
set "BAK="
set /p BAK=<"%HERE%jicate-box-agent.swapped"
del "%HERE%jicate-box-agent.swapped" >nul 2>&1
if not defined BAK exit /b 0
if not exist "%HERE%%BAK%" exit /b 0
copy /y "%AGENT%" "%AGENT%.rejected" >nul
copy /y "%HERE%%BAK%" "%AGENT%" >nul
>>"%LOG%" echo %DATE% %TIME% [launcher] the new jicate-box-agent.mjs did not reach the Tower; restored %BAK%, new one kept as jicate-box-agent.mjs.rejected
exit /b 0

:swapagent
call :stamp
copy /y "%HERE%jicate-box-agent.mjs.new" "%HERE%jicate-box-agent.check.mjs" >nul
"%NODE_BIN%" --check "%HERE%jicate-box-agent.check.mjs" >> "%LOG%" 2>&1
if errorlevel 1 goto :swapagent_bad
del "%HERE%jicate-box-agent.check.mjs" >nul 2>&1
copy /y "%AGENT%" "%AGENT%.bak-%STAMP%" >nul
if errorlevel 1 goto :swapagent_keep
move /y "%HERE%jicate-box-agent.mjs.new" "%AGENT%" >nul
if errorlevel 1 goto :swapagent_keep
>"%HERE%jicate-box-agent.swapped" echo jicate-box-agent.mjs.bak-%STAMP%
>>"%LOG%" echo %DATE% %TIME% [launcher] installed the staged jicate-box-agent.mjs, previous one kept as jicate-box-agent.mjs.bak-%STAMP%
exit /b 0
:swapagent_keep
>>"%LOG%" echo %DATE% %TIME% [launcher] could not install the staged jicate-box-agent.mjs; it stays staged
exit /b 0
:swapagent_bad
del "%HERE%jicate-box-agent.check.mjs" >nul 2>&1
move /y "%HERE%jicate-box-agent.mjs.new" "%AGENT%.rejected" >nul
>>"%LOG%" echo %DATE% %TIME% [launcher] the staged jicate-box-agent.mjs failed node --check; renamed to jicate-box-agent.mjs.rejected
exit /b 0

:stamp
set "STAMP="
for /f "delims=" %%s in ('powershell.exe -NoProfile -NonInteractive -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%s"
if not defined STAMP set "STAMP=prev"
exit /b 0
