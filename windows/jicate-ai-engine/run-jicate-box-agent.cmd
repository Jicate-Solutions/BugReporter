@echo off
REM JICATE box account agent - Windows wrapper. Reads box-agent.env next to this file.
set "HERE=%~dp0"
REM Absolute path: bare "node" does not resolve under Task Scheduler.
set "NODE_BIN=__NODE_EXE__"
if not exist "%HERE%logs" mkdir "%HERE%logs"
"%NODE_BIN%" "%HERE%jicate-box-agent.mjs" >> "%HERE%logs\box-agent.log" 2>&1