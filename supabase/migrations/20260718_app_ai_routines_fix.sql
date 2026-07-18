-- 20260718_app_ai_routines_fix.sql
-- Reliability follow-up to 20260718_app_ai_routines.sql (advisory ultracode panel).
-- Additive/replace only.
--
-- HIGH: last_run_at was stamped at claim → a buildInput throw / enqueue timeout /
--       cron kill lost the day with no retry. Fix: a short-lived claimed_at marker
--       for concurrency; last_run_at is stamped ONLY on success (record_fire 'done').
-- MED : all time gates now anchored to UTC (were session-tz vs UTC-mismatched).
-- MED : claim is batched (LIMIT + FOR UPDATE SKIP LOCKED) and excludes routines
--       with an in-flight run so a slow Max-lane job can't be re-enqueued.
-- LOW : minute_of_day capped to the */15 tick grid (last same-day tick = 23:45).

ALTER TABLE public.app_ai_routines ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE public.app_ai_routines DROP CONSTRAINT IF EXISTS app_ai_routines_minute_of_day_check;
ALTER TABLE public.app_ai_routines
  ADD CONSTRAINT app_ai_routines_minute_of_day_check CHECK (minute_of_day BETWEEN 0 AND 1425);

-- signature changes (adds p_limit) → drop the old no-arg version first
DROP FUNCTION IF EXISTS public.fn_app_routine_claim_due();

CREATE OR REPLACE FUNCTION public.fn_app_routine_claim_due(p_limit int DEFAULT 25)
RETURNS SETOF public.app_ai_routines
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.app_ai_routines r
     SET claimed_at = now(), updated_at = now()
   WHERE r.id IN (
     SELECT r2.id FROM public.app_ai_routines r2
      WHERE r2.enabled = true
        AND (EXTRACT(DOW FROM now() AT TIME ZONE 'UTC')::int) = ANY (r2.days_of_week)
        AND (EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::int * 60
             + EXTRACT(MINUTE FROM now() AT TIME ZONE 'UTC')::int) >= r2.minute_of_day
        -- not already SUCCESSFULLY run today (UTC)
        AND (r2.last_run_at IS NULL OR (r2.last_run_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date)
        -- not claimed in the last 30 min (retry window after a failed attempt)
        AND (r2.claimed_at IS NULL OR r2.claimed_at < now() - interval '30 minutes')
        -- not currently in flight (prevents re-enqueue of a slow job)
        AND NOT EXISTS (
          SELECT 1 FROM public.app_ai_routine_runs run
           WHERE run.routine_id = r2.id AND run.status IN ('queued','running')
        )
      ORDER BY r2.minute_of_day
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

-- On success ('done') stamp last_run_at (the once-per-day guard). On 'running'
-- or 'error' just update status, so a failure retries after the claim window and
-- never silently consumes the day.
CREATE OR REPLACE FUNCTION public.fn_app_routine_record_fire(p_routine_id uuid, p_status text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.app_ai_routines
     SET last_status = p_status,
         last_run_at = CASE WHEN p_status = 'done' THEN now() ELSE last_run_at END,
         updated_at  = now()
   WHERE id = p_routine_id;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_app_routine_claim_due(int)             FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_app_routine_record_fire(uuid, text)    FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_claim_due(int)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_record_fire(uuid, text)    TO service_role;
