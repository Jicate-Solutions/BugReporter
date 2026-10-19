-- Add the two states that split "done" into "the developer finished" and
-- "the client agrees".
--
-- Until now a bug ended at `resolved`, which one person set and nobody
-- confirmed. On Raagam-Export that produced exactly the failure this migration
-- exists to fix: of 31 status changes, every single one was made by a reporter
-- and 26 of them moved a bug straight from `new` to `resolved`. No developer
-- ever touched a status. "Resolved" therefore meant "the client decided it was
-- fine", which is not what anybody reading the dashboard assumed it meant.
--
--   new -> seen -> in_progress
--                       |  developer, from the dashboard
--                 ready_for_testing      "the fix is done, please test"
--                       |  client, from the portal
--                    closed              "I tested it, it works"
--
-- `resolved` is deliberately left in the list. 399 rows across the platform
-- carry it, it is stamped into bug_status_events history that must stay
-- readable, and rewriting it here would relabel work nobody re-examined. It
-- becomes a legacy value: still valid, no longer produced by the flow above.
--
-- No data is migrated by this file. Widening a CHECK constraint cannot fail on
-- existing rows and cannot lock anything meaningfully, so this is safe to run
-- ahead of any decision about the bugs already sitting in `resolved`.
--
-- bug_status_events needs no change: its from_status/to_status columns carry no
-- CHECK constraint, only actor_kind does (see 20260805_reporter_status_actor).

ALTER TABLE public.bug_reports
  DROP CONSTRAINT IF EXISTS bug_reports_status_check;

ALTER TABLE public.bug_reports
  ADD CONSTRAINT bug_reports_status_check
  CHECK (
    status IN (
      'new',
      'seen',
      'in_progress',
      'ready_for_testing',
      'resolved',
      'closed',
      'wont_fix'
    )
  );

COMMENT ON COLUMN public.bug_reports.status IS
  'Workflow state. ready_for_testing is set by a developer and asks the client to verify; closed is the client agreeing. resolved is legacy - it predates that split and is no longer produced by the flow.';

DO $$
BEGIN
  RAISE NOTICE 'bug_reports.status now accepts ready_for_testing and closed';
END $$;
