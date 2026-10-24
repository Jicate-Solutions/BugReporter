-- 20261024_ai_task_builder.sql
-- AI task builder, part 1 (Director, 2026-10-24).
--
-- Developers can now create AI tasks for the apps they belong to, and draft
-- edits to any existing task. A draft never changes the live recipe: it waits
-- in ai_task_versions until a test run passes (the test runner is a later PR).
-- Every edit is kept, so an earlier version can be restored.
--
--   ai_tasks.created_by          the task's owner (kept running if they leave)
--   ai_tasks.owner_app           the app the task belongs to; NULL = shared/legacy
--   ai_tasks.queue_wait_seconds  how long a request may wait for a free box
--                                (read by the run path in a later PR)
--   ai_task_versions             one row per saved version of a recipe
--
-- Writes to ai_task_versions go only through the server (service role); the
-- signed-in API can read versions of tasks whose app is in an organisation the
-- reader belongs to, and super admins can read all.
--
-- Additive only. Safe to run twice.

-- ── 1. owner, owner app, wait-for-a-box time ─────────────────────────────────
ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS owner_app uuid REFERENCES public.applications(id) ON DELETE SET NULL;
ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS queue_wait_seconds int NOT NULL DEFAULT 120;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_tasks_queue_wait_seconds_check'
  ) THEN
    ALTER TABLE public.ai_tasks
      ADD CONSTRAINT ai_tasks_queue_wait_seconds_check
      CHECK (queue_wait_seconds BETWEEN 5 AND 3600);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_owner_app ON public.ai_tasks(owner_app);

-- ── 2. version history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_task_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL REFERENCES public.ai_tasks(job_type) ON DELETE CASCADE,
  version       int NOT NULL CHECK (version >= 1),
  recipe        jsonb NOT NULL,                 -- the full recipe as saved
  status        text NOT NULL CHECK (status IN ('draft', 'published', 'restored')),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  tested_ok_at  timestamptz,                    -- set by the test runner (later PR)
  UNIQUE (job_type, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_task_versions_job ON public.ai_task_versions(job_type, version DESC);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- The policy cannot join ai_tasks directly: ai_tasks_read is super-admin only,
-- so the subquery would see nothing for anyone else. This helper resolves
-- job_type → owner_app → organisation → membership with definer rights.
CREATE OR REPLACE FUNCTION public.fn_ai_task_visible_to(p_job_type text, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = p_user)
      OR EXISTS (
           SELECT 1
             FROM public.ai_tasks t
             JOIN public.applications a ON a.id = t.owner_app
             JOIN public.organization_members m ON m.organization_id = a.organization_id
            WHERE t.job_type = p_job_type
              AND m.user_id = p_user
         );
$$;

REVOKE ALL ON FUNCTION public.fn_ai_task_visible_to(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_task_visible_to(text, uuid) TO authenticated, service_role;

ALTER TABLE public.ai_task_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_task_versions_read ON public.ai_task_versions;
CREATE POLICY ai_task_versions_read ON public.ai_task_versions
  FOR SELECT TO authenticated
  USING (public.fn_ai_task_visible_to(job_type, auth.uid()));

REVOKE ALL ON public.ai_task_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_task_versions FROM authenticated;
