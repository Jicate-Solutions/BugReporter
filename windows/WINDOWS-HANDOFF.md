# MISSION: Add the BugReporter triage drain to the Windows AI box (ONE task, ONE folder)

This adds a separate folder and one scheduled task. Nothing else on the box changes:
every `ai.jkkn.maxlane.*` task, the MyJKKN drains, the intent drains and their env files stay
exactly as they are.

**Why it exists.** Director rule, 10 Oct 2026: bug text from client apps (Elevar ERP, Raagam,
Kenavo, Poppys, BuildWise, Quotation Office) must never enter the MyJKKN college database, not even
briefly. So bugs are not triaged through MyJKKN's `ai_jobs`. This drain asks the central bug
reporter for one bug at a time, runs Claude on this box, and hands the verdict back to the
bug reporter, which writes it on the bug as an internal note. It serves every app in the central
reporter that has triage switched on, client or internal (Director, 10 Oct 2026, 18:10), because
this path keeps all bug text inside the central reporter.

**What this box holds.** One bearer token (`TRIAGE_RUNNER_TOKEN`) and the bug reporter's address.
No Supabase key of any kind. The token opens exactly two routes (claim and complete) and nothing else.

| Task name | Runs | Runner name the server records |
|---|---|---|
| `ai.jicate.bugreporter-triage` | `run-triage-drain.cmd` → `bugreporter-triage-drain.mjs` (forever loop, 15 s idle) | `windows-triage` |

## PRE-CONDITIONS (do not install before these are done)

1. The migration `supabase/migrations/20261010_client_triage_lane.sql` is applied to the bug
   reporter's database.
2. The Director has set `TRIAGE_RUNNER_TOKEN` in Vercel for the bug reporter and it is deployed.
   Until then both routes answer `503 TRIAGE_NOT_CONFIGURED` and the drain just idles.

## INSTALL

1. Create `C:\Users\Admin\jkkn-max-lane\bug-reporter\` and `C:\jkkn\bugreporter-triage-sandbox\`.
   The sandbox must be EMPTY with no CLAUDE.md or `.claude` above it — `claude -p` walks up from its cwd.
2. Copy these three files from the repo's `windows/` folder into
   `C:\Users\Admin\jkkn-max-lane\bug-reporter\`, unchanged:
   `bugreporter-triage-drain.mjs`, `run-triage-drain.cmd`, `ai.jicate.bugreporter-triage.xml`.
3. Create `triage.env` in that same folder with EXACTLY these two lines. The token value is carried
   over by the Director by hand; it is never written in this document, a commit, a PR or a chat:
   ```
   BUGREPORTER_URL=https://jkkn-centralized-bug-reporter.vercel.app
   TRIAGE_RUNNER_TOKEN=<the Director pastes the value here>
   ```
   No quotes, no trailing spaces. No other lines — in particular no Supabase URL or key.
4. If `claude` is not on PATH for `cmd.exe`, uncomment the `CLAUDE_BIN` line in
   `run-triage-drain.cmd` and point it at the same binary the other drains use. The drain calls it with
   `-p --model sonnet --output-format json --restricted --strict-mcp-config --no-session-persistence
   --disable-slash-commands --allowedTools ""` (no tools, no MCP, no hooks, no transcript).
5. `node --check bugreporter-triage-drain.mjs` → prints nothing.
6. Prove it before registering. In a console in that folder:
   ```
   set ONESHOT=1
   run-triage-drain.cmd
   ```
   Then read `logs\triage-drain.log`. Expect a `[triage-drain] start runner=windows-triage ...` line,
   and then either nothing more (queue empty) or `claimed ... / DONE ...`.
   Must NOT appear: `missing BUGREPORTER_URL or TRIAGE_RUNNER_TOKEN`, `-> 401`, `-> 503`.
   (`401` = wrong token in `triage.env`; `503` = token not set in Vercel yet.)
   Close the console so `ONESHOT` does not leak into anything else.
7. Register with `schtasks.exe /create /xml` (unelevated `Register-ScheduledTask` is denied on this box):
   ```
   schtasks.exe /create /tn "ai.jicate.bugreporter-triage" /xml .\ai.jicate.bugreporter-triage.xml /f
   schtasks.exe /run /tn "ai.jicate.bugreporter-triage"
   ```
   If schtasks calls the XML malformed, re-save it as UTF-16 LE
   (`Get-Content .\ai.jicate.bugreporter-triage.xml | Set-Content -Encoding Unicode .\task16.xml`)
   and register `task16.xml`. If the principal is rejected, copy the `<Principals>` block from
   `schtasks /query /tn "ai.jicate.intent-drain-batch" /xml` — the shape that already works here wins.

## KILL-TEST

1. `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*bugreporter-triage-drain*' | Select ProcessId`
2. `Stop-Process -Id <that PID>`
3. Within about 60 seconds the same command must show a NEW PID (the task re-fires every minute and
   `IgnoreNew` stops duplicates). If none appears after 2 minutes, check `schtasks /query /tn
   "ai.jicate.bugreporter-triage" /v /fo list` for `Last Result`.

## VERIFY (end to end — registration is not proof)

- `Get-Process node` shows one extra node process for this drain.
- Ask the Mac session (or anyone with access to the bug reporter's database) to:
  1. switch triage on for ONE pilot app (Edit → "AI triage for new bugs"), and file a test bug in
     that app (or run the backfill for it);
  2. check `triage_jobs`: the row goes `queued` → `claimed` (`claimed_by = 'windows-triage'`) → `done`;
  3. open the bug in the dashboard: one internal message from **AI triage** with type, severity,
     summary and likely area. The bug's status is unchanged.
- Report back: the task name, its `Last Result`, and the first `claimed` and `DONE` lines from
  `logs\triage-drain.log` (they contain ids only, never bug text).

## Do NOT

- Do not touch any `ai.jkkn.maxlane.*` task, the MyJKKN `.env`, or the intent drains.
- Do not put any Supabase key on this box for this lane. If something seems to need one, stop and ask.
- Do not put the token in the task XML, the `.cmd`, a log line or a message — it lives only in `triage.env`.
- Do not add a lock dir, a self-exit timer, or a Windows service.
- Do not point this drain at MyJKKN. It only ever talks to the bug reporter.
