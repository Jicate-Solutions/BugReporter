-- 20261019_jicate_ai_engine_tasks_policy.sql
-- Narrow who can read recipe text through the API. The first migration let any
-- signed-in user SELECT ai_tasks, which exposes the recipe wording more widely
-- than the pages do. Pages and the task tick-list read through the service
-- client, so this changes nothing on screen; it only closes the direct-API path.
-- Safe to run twice.
DROP POLICY IF EXISTS ai_tasks_read ON public.ai_tasks;
CREATE POLICY ai_tasks_read ON public.ai_tasks
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
  );
