-- 20261019_ai_engine_watch.sql
-- Memory for the AI engine watch cron (/api/cron/ai-engine-watch): whether the
-- Windows workers were last seen down, and when the last safety-alert email
-- went out, so each email is sent once and not every five minutes.
--
-- Additive only. Safe to run twice. Service role only.

CREATE TABLE IF NOT EXISTS public.ai_engine_watch (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_engine_watch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_engine_watch FROM anon, authenticated;
