@echo off
REM JICATE box account agent - Windows wrapper. Reads box-agent.env next to this file.
REM
REM Staged self-update (2026-10-24). The agent never overwrites its own files: it
REM writes jicate-box-agent.mjs.new or run-jicate-box-agent.cmd.new, then exits when
REM idle, and Task Scheduler starts this launcher again within a minute.
REM  - At start, a staged agent is checked with node --check (on a .mjs copy, since
REM    node will not parse a .new file as ESM), the current one is kept as
REM    jicate-box-agent.mjs.bak-<stamp>, then the staged one is moved in. A failed
REM    check renames it to jicate-box-agent.mjs.rejected (the agent then never
REM    tries that sha again).
REM  - jicate-box-agent.swapped names the backup until the new agent reaches the
REM    Tower (the agent deletes it). If it is still here at the next start, the new
REM    agent stopped before it ever got through: the backup is restored and the new
REM    one kept as jicate-box-agent.mjs.rejected.
REM  - At the very end, a staged launcher replaces THIS file. cmd.exe reads a batch
REM    file line by line from a byte offset, so replacing it and then reading on
REM    would run garbage. The copy, the move and the exit are on ONE line: cmd has
REM    parsed the whole line before the file changes, and exit /b means it never
REM    reads this file again.
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
if exist "%HERE%run-jicate-box-agent.cmd.new" call :stamp
if exist "%HERE%run-jicate-box-agent.cmd.new" (copy /y "%~f0" "%~f0.bak-%STAMP%" >nul & >>"%LOG%" echo %DATE% %TIME% [launcher] installing the staged run-jicate-box-agent.cmd, previous one kept as run-jicate-box-agent.cmd.bak-%STAMP% & move /y "%HERE%run-jicate-box-agent.cmd.new" "%~f0" >nul & exit /b 0)
exit /b 0

:rollback
set "BAK="
set /p BAK=<"%HERE%jicate-box-agent.swapped"
del "%HERE%jicate-box-agent.swapped" >nul 2>&1
if not defined BAK exit /b 0
if not exist "%HERE%%BAK%" exit /b 0
copy /y "%AGENT%" "%AGENT%.rejected" >nul
copy /y "%HERE%%BAK%" "%AGENT%" >nul
>>"%LOG%" echo %DATE% %TIME% [launcher] the new jicate-box-agent.mjs stopped before it reached the Tower; restored %BAK%, new one kept as jicate-box-agent.mjs.rejected
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
