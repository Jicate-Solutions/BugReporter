# MISSION: Make this Windows box JICATE's AI worker (one folder, two scheduled tasks)

**Who asked.** The Director (Omm), 2026-10-19: JICATE's AI work runs on JICATE's own engine,
on this second Windows box, not on MyJKKN's. The Director approves this install by typing into
this machine's session himself. An approval relayed from another tab does not count.

**What it does.** Two always-on workers (`jicate-1`, `jicate-2`) take AI jobs from the JICATE
Control Tower (`https://jkkn-centralized-bug-reporter.vercel.app`), run the prompt they are given
through this box's Claude CLI on the Max plan (₹0), and hand the answer back. Same shape as the
MyJKKN Max lane on BIOMETRIC. Nothing here talks to MyJKKN.

**What this box holds.** One random token per worker, generated ON THIS BOX by
`new-runner-token.ps1`. Only its SHA-256 hash is sent to the Mac tab "jicate ai engine", which
registers it. No Supabase key, no app key, no other secret. A token opens two routes (claim and
complete) and nothing else.

| Task name | Runs | Worker name the server records | Log |
|---|---|---|---|
| `ai.jicate.engine-1` | `run-jicate-ai-drain.cmd jicate-1` | `jicate-1` | `C:\jicate-ai\logs\jicate-1.log` |
| `ai.jicate.engine-2` | `run-jicate-ai-drain.cmd jicate-2` | `jicate-2` | `C:\jicate-ai\logs\jicate-2.log` |

## INSTALL

1. **Folders.** Create `C:\jicate-ai\` and `C:\jicate-ai\sandbox\`. There must be NO `CLAUDE.md` and
   no `.claude` folder in `C:\` or `C:\jicate-ai\`. `claude -p` walks up from its working
   folder and would load them.
2. **Files.** Put these five files from the repo folder `windows/jicate-ai-engine/` (branch
   `feat/jicate-ai-engine` of `Jicate-Solutions/BugReporter`) into `C:\jicate-ai\`, unchanged:
   `jicate-ai-drain.mjs`, `run-jicate-ai-drain.cmd`, `new-runner-token.ps1`,
   `ai.jicate.engine-1.xml`, `ai.jicate.engine-2.xml`.
   With gh signed in, `gh api` can fetch each one. Otherwise ask the Mac tab to send them.
3. **Paths in the wrapper.** In `run-jicate-ai-drain.cmd`, replace `__CLAUDE_EXE__` with the absolute
   path to `claude.exe` and `__NODE_EXE__` with the absolute path to `node.exe` (`where node`).
   Bare names do not resolve under Task Scheduler.
4. **Self-test, no server needed.** In `C:\jicate-ai\`:
   ```
   set SELFTEST=1
   set CLAUDE_BIN=<the claude.exe path>
   node jicate-ai-drain.mjs
   ```
   Expect a line ending in `SELFTEST answer="pong" model=claude-...`. That proves the Claude path,
   the Max sign-in and the locked-down flags (no tools, no MCP, no hooks, no transcript).
   Close that console afterwards so `SELFTEST` does not leak into anything.
5. **Tokens.** For each worker:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner jicate-1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\new-runner-token.ps1 -Runner jicate-2
   ```
   Each prints one line: `runner=jicate-1 sha256=<64 hex>`. Send ONLY those two lines to the Mac
   tab "jicate ai engine" with SendMessage. Never open, print, copy or send the `.env` files.
   Wait for the Mac tab to answer that both hashes are registered.
6. **Register the tasks.** Unelevated `Register-ScheduledTask` may be denied; use:
   ```
   schtasks.exe /create /tn "ai.jicate.engine-1" /xml C:\jicate-ai\ai.jicate.engine-1.xml /f
   schtasks.exe /create /tn "ai.jicate.engine-2" /xml C:\jicate-ai\ai.jicate.engine-2.xml /f
   schtasks.exe /run /tn "ai.jicate.engine-1"
   schtasks.exe /run /tn "ai.jicate.engine-2"
   ```
7. **Read the logs.** Each log should show `start runner=jicate-N ...`.
   - Until the Control Tower code is deployed, `claim error: ... -> 404` once a minute is EXPECTED.
     The worker waits 60 s between tries.
   - `-> 401` means the hash is not registered yet, or the `.env` file is wrong.
   - After deploy the log is silent when idle and shows `claimed ... / DONE ...` per job.
8. **Kill-test.** Reading the task registration is not proof. Kill the workers and watch them return:
   ```
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -like '*jicate-ai-drain*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
   ```
   Within about 60 to 90 s each log must show a NEW `start runner=...` line. Report the times.
9. **Report** to the Mac tab: self-test line, the two task names, kill-test relaunch times, and
   the last 3 lines of each log. No secrets.

## Rollback

```
schtasks.exe /end /tn "ai.jicate.engine-1" & schtasks.exe /delete /tn "ai.jicate.engine-1" /f
schtasks.exe /end /tn "ai.jicate.engine-2" & schtasks.exe /delete /tn "ai.jicate.engine-2" /f
```
Then delete `C:\jicate-ai\`. The Mac tab revokes the two hashes. Nothing else on the box changes.

## Rules carried over from the MyJKKN Max lane

- Always-on means a TimeTrigger every minute plus `IgnoreNew`, never at-logon alone. Prove it with the kill-test.
- Timeouts kill with SIGKILL. The server re-queues a job a dead worker left behind.
- Every run, success or failure, is reported, so the usage ledger shows every run at ₹0.
- People-waiting jobs go first. Workers poll every 3 s so a reply lands inside 60 s.
- No per-job credential file is needed: jobs run with no tools, so no user token ever touches disk.
- Rate limits: a worker pauses 60 s after one. If they recur under normal load, stop `ai.jicate.engine-2` first.
