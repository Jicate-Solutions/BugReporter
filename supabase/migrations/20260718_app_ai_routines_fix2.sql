-- 20260718_app_ai_routines_fix2.sql
-- Second reliability pass (advisory ultracode panel re-run). Additive/replace.
--
-- HIGH: a stuck queued/running run (hung Door / 'unknown' poll) blocked its
--       routine forever because the in-flight guard had no age bound. Fix: bound
--       the guard to 1h (COLLECT also TTL-fails stale runs → re-claimable).
-- LOW : prune floor (GREATEST); write-policy also verifies application_id belongs
--       to the org; minute_of_day check re-added safely (clamp then constrain).

-- age-bounded in-flight guard
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
        AND (r2.last_run_at IS NULL OR (r2.last_run_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date)
        AND (r2.claimed_at IS NULL OR r2.claimed_at < now() - interval '30 minutes')
        AND NOT EXISTS (
          SELECT 1 FROM public.app_ai_routine_runs run
           WHERE run.routine_id = r2.id
             AND run.status IN ('queued','running')
             AND run.started_at > now() - interval '1 hour'   -- age-bound (HIGH)
        )
      ORDER BY r2.minute_of_day
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

-- prune floor (p_days=0 must not wipe all history; negative must not delete future)
CREATE OR REPLACE FUNCTION public.fn_app_routine_prune(p_days int DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.app_ai_routine_runs
   WHERE started_at < now() - (GREATEST(p_days, 1) || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- write-policy also requires application_id (when set) to belong to the org
DROP POLICY IF EXISTS app_ai_routines_write ON public.app_ai_routines;
CREATE POLICY app_ai_routines_write ON public.app_ai_routines
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = app_ai_routines.organization_id
        AND m.role = ANY (ARRAY['owner','admin'])
    )
  ) WITH CHECK (
    (
      EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.organization_members m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = app_ai_routines.organization_id
          AND m.role = ANY (ARRAY['owner','admin'])
      )
    )
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = app_ai_routines.application_id
          AND a.organization_id = app_ai_routines.organization_id
      )
    )
  );

-- re-add the cadence check safely on a populated table: clamp offenders first.
UPDATE public.app_ai_routines SET minute_of_day = 1425 WHERE minute_of_day > 1425;
ALTER TABLE public.app_ai_routines DROP CONSTRAINT IF EXISTS app_ai_routines_minute_of_day_check;
ALTER TABLE public.app_ai_routines
  ADD CONSTRAINT app_ai_routines_minute_of_day_check CHECK (minute_of_day BETWEEN 0 AND 1425);

REVOKE EXECUTE ON FUNCTION public.fn_app_routine_claim_due(int) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_app_routine_prune(int)     FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_claim_due(int) TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_prune(int)     TO service_role;
