-- Let a reporter be recorded as the actor behind a status change.
--
-- The Bug Status Portal is about to let a reporter say "this is still broken"
-- on a bug the team marked resolved. That change goes through
-- applyStatusChange() like every other status write, which means it writes a
-- bug_status_events row — and that table's CHECK constraint currently admits
-- only dashboard_user, api_key and system. Without this, the reopen would fail
-- at the audit-trail insert, which applyStatusChange treats as non-fatal, so the
-- status would move with no record of who moved it. Silent history loss is worse
-- than a hard failure, so the constraint is widened first.
--
-- No new column: the reporter's email goes in the existing actor_label, exactly
-- as an API key's label does. actor_user_id stays null — a reporter is not a
-- platform user and may never have had an account.
--
-- bug_status_events is empty at the time of writing, so re-adding the constraint
-- validates instantly and needs no NOT VALID / VALIDATE split.

ALTER TABLE public.bug_status_events
  DROP CONSTRAINT IF EXISTS bug_status_events_actor_kind_check;

ALTER TABLE public.bug_status_events
  ADD CONSTRAINT bug_status_events_actor_kind_check
  CHECK (actor_kind IN ('dashboard_user', 'api_key', 'system', 'reporter'));

-- bug_reports.reopened_at / reopen_reason / reopen_count already exist in
-- production and have never been written by anything. Nothing to add here — this
-- comment exists so the next reader knows that was checked, not overlooked.
COMMENT ON COLUMN public.bug_reports.reopen_count IS
  'Times this bug has moved from a terminal status back to an open one. Written by applyStatusChange(). Display counter — bug_status_events is the authoritative trail.';
