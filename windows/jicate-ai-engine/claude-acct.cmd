@echo off
REM claude-acct.cmd - stands in for claude.exe for the MyJKKN max lanes (see ACCOUNTS.md).
REM Arguments pass through unchanged to claude-acct.mjs, which runs the real claude.exe.
REM Replace __NODE_EXE__ with the full path of node.exe (bare "node" does not resolve under Task Scheduler).
REM NOTE: Node 18.20.2+/20.12.2+/22 refuse to execFile() a .cmd without shell:true (EINVAL).
REM Run install step 4 (ACCOUNTS.md) first; if it fails, use claude-acct.exe (claude-acct-launcher.cs) instead.
"__NODE_EXE__" "%~dp0claude-acct.mjs" %*
exit /b %ERRORLEVEL%
