@echo off
REM claude-acct.cmd - stands in for claude.exe for the MyJKKN max lanes (see ACCOUNTS.md).
REM Arguments pass through unchanged to claude-acct.mjs, which runs the real claude.exe.
REM Replace __NODE_EXE__ with the full path of node.exe (bare "node" does not resolve under Task Scheduler).
REM FALLBACK ONLY: the default launcher is claude-acct.exe (claude-acct-launcher.cs, ACCOUNTS.md step 4).
REM Node 18.20.2+/20.12.2+/22 refuse to execFile() a .cmd without shell:true (EINVAL), and cmd.exe
REM re-reads %* so job text in an argument could inject commands. Use this only if csc.exe is missing.
"__NODE_EXE__" "%~dp0claude-acct.mjs" %*
exit /b %ERRORLEVEL%
