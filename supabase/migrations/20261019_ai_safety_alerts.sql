-- 20261019_ai_safety_alerts.sql
-- Safety alerts from the JICATE AI engine.
--
-- When a learner writes something worrying (being hurt, or thinking of hurting
-- themselves or someone else), the recipe tells the model to reply kindly and
-- add a hidden marker. The complete route strips the marker before the answer
-- is stored and writes one row here. Platform admins see these on the Safety
-- alerts page and mark each one followed up. Director decision, 2026-10-19:
-- alerts land with him first, inside the Control Tower.
--
-- The learner's words are NOT copied here; the row points at the job, whose
-- payload already lives in ai_jobs. If the job is pruned (90 days), the alert
-- row stays as a record and job_id becomes NULL.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_safety_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid UNIQUE REFERENCES public.ai_jobs(id) ON DELETE SET NULL,
  job_type         text NOT NULL,
  app_slug         text NOT NULL,
  organization_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  followed_up_at   timestamptz,
  followed_up_by   uuid
);

CREATE INDEX IF NOT EXISTS ai_safety_alerts_open_idx
  ON public.ai_safety_alerts (created_at DESC) WHERE followed_up_at IS NULL;

ALTER TABLE public.ai_safety_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_safety_alerts_super_admin_read ON public.ai_safety_alerts;
CREATE POLICY ai_safety_alerts_super_admin_read ON public.ai_safety_alerts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));

REVOKE ALL ON public.ai_safety_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_safety_alerts FROM authenticated;
