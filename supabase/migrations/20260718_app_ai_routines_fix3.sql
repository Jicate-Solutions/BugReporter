-- 20260718_app_ai_routines_fix3.sql
-- Third pass (advisory ultracode panel re-run on the Phase 2 Routines UI PR). Additive.
--
-- MED: a manual "Run now" and a scheduled run were indistinguishable at the run
--      level — both land as status='running' with a job_id. If a manual run was
--      still in-flight at a */15 cron tick, the dispatcher's COLLECT phase polled
--      it to 'done' and stamped routine.last_run_at (finishDone). The daily-slot
--      guard in fn_app_routine_claim_due then treats the routine as "already ran
--      today", silently suppressing that day's SCHEDULED brief — a nondeterministic
--      loss depending on whether the client poll or the cron collects the run first.
--      Manual runs are meant never to consume the daily slot (the run-now POST/GET
--      path deliberately never touches the routine, only the run row).
-- Fix: tag each run row with its trigger source so the dispatcher can skip the
--      routine stamp for manual runs — parity with the client GET poll.

ALTER TABLE public.app_ai_routine_runs
  ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'schedule';

ALTER TABLE public.app_ai_routine_runs
  DROP CONSTRAINT IF EXISTS app_ai_routine_runs_trigger_source_check;
ALTER TABLE public.app_ai_routine_runs
  ADD CONSTRAINT app_ai_routine_runs_trigger_source_check
  CHECK (trigger_source IN ('schedule', 'manual'));

-- Existing rows default to 'schedule' (correct: they were all dispatcher-fired or
-- the seeded demo run). The dispatcher's recordRun leaves the column unset → the
-- 'schedule' default applies; only the run-now route sets 'manual' explicitly.
