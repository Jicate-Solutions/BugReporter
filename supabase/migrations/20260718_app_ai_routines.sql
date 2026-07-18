-- 20260718_app_ai_routines.sql
-- Per-app AI Routines — the first "operate" pillar of the Jicate Apps Control Tower.
-- Reporter-owned schedules + run history. A reporter dispatcher cron fires due
-- routines against the MyJKKN AI Door (₹0 Max lane) and records results here.
--
-- Additive only: CREATE ... IF NOT EXISTS, new policies/functions. No drops, no
-- data mutation. Isolation mirrors the `applications` table's org-membership RLS.
-- Decisions (locked): writes = org owners/admins only; new routines start PAUSED;
-- 90-day run retention; empty runs are recorded ("all clear").

-- ── 1. schedules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_ai_routines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES public.applications(id) ON DELETE CASCADE, -- NULL = fleet-level
  routine_kind     text NOT NULL,                        -- matches the code registry id
  enabled          boolean NOT NULL DEFAULT false,        -- start PAUSED (locked decision)
  days_of_week     int[]   NOT NULL DEFAULT '{1,2,3,4,5}',-- 0=Sun .. 6=Sat (Mon-Fri default)
  minute_of_day    int     NOT NULL DEFAULT 210 CHECK (minute_of_day BETWEEN 0 AND 1439), -- 03:30 UTC = 09:00 IST
  config           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  last_run_at      timestamptz,
  last_status      text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One routine-kind per app; one fleet-level (app NULL) routine-kind per org.
CREATE UNIQUE INDEX IF NOT EXISTS app_ai_routines_app_uniq
  ON public.app_ai_routines (organization_id, application_id, routine_kind)
  WHERE application_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_ai_routines_fleet_uniq
  ON public.app_ai_routines (organization_id, routine_kind)
  WHERE application_id IS NULL;
CREATE INDEX IF NOT EXISTS app_ai_routines_enabled_idx
  ON public.app_ai_routines (enabled) WHERE enabled = true;

-- ── 2. run history (where results land) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_ai_routine_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id       uuid NOT NULL REFERENCES public.app_ai_routines(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,   -- denormalized for RLS + queries
  application_id   uuid,
  routine_kind     text NOT NULL,
  status           text NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  job_id           text,                            -- the engine job id
  result           jsonb,                           -- briefing blocks / dupe pairs / {allClear:true}
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX IF NOT EXISTS app_ai_routine_runs_routine_idx
  ON public.app_ai_routine_runs (routine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS app_ai_routine_runs_poll_idx
  ON public.app_ai_routine_runs (status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS app_ai_routine_runs_prune_idx
  ON public.app_ai_routine_runs (started_at);

-- ── 3. RLS — read = org members, write = org owners/admins (or super admin) ──
ALTER TABLE public.app_ai_routines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_ai_routine_runs ENABLE ROW LEVEL SECURITY;

-- schedules: members read
CREATE POLICY app_ai_routines_read ON public.app_ai_routines
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR organization_id IN (
      SELECT m.organization_id FROM public.organization_members m WHERE m.user_id = auth.uid()
    )
  );
-- schedules: owners/admins write (create/enable/schedule/delete) — locked decision
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
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = app_ai_routines.organization_id
        AND m.role = ANY (ARRAY['owner','admin'])
    )
  );

-- runs: members read; writes only via service-role (dispatcher / server) which bypasses RLS
CREATE POLICY app_ai_routine_runs_read ON public.app_ai_routine_runs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR organization_id IN (
      SELECT m.organization_id FROM public.organization_members m WHERE m.user_id = auth.uid()
    )
  );

-- ── 4. dispatcher RPCs (SECURITY DEFINER, service-role only) ──────────────────
-- Atomically CLAIM due routines (UPDATE ... RETURNING) so overlapping crons can't
-- double-fire the same routine. "Due" = enabled, today is in days_of_week, the
-- minute-of-day has passed, and it hasn't already run today (UTC).
CREATE OR REPLACE FUNCTION public.fn_app_routine_claim_due()
RETURNS SETOF public.app_ai_routines
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.app_ai_routines r
     SET last_run_at = now(), last_status = 'running', updated_at = now()
   WHERE r.enabled = true
     AND (EXTRACT(DOW FROM now())::int) = ANY (r.days_of_week)
     AND (EXTRACT(HOUR FROM now()) * 60 + EXTRACT(MINUTE FROM now()))::int >= r.minute_of_day
     AND (r.last_run_at IS NULL
          OR (r.last_run_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date)
  RETURNING r.*;
$$;

CREATE OR REPLACE FUNCTION public.fn_app_routine_record_fire(p_routine_id uuid, p_status text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.app_ai_routines SET last_status = p_status, updated_at = now() WHERE id = p_routine_id;
$$;

-- 90-day retention (piggybacks the dispatcher cron).
CREATE OR REPLACE FUNCTION public.fn_app_routine_prune(p_days int DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.app_ai_routine_runs WHERE started_at < now() - (p_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Lock the RPCs to service-role only (anon/authenticated must not call them).
REVOKE EXECUTE ON FUNCTION public.fn_app_routine_claim_due()               FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_app_routine_record_fire(uuid, text)   FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_app_routine_prune(int)                FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_claim_due()               TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_record_fire(uuid, text)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_app_routine_prune(int)                TO service_role;
