-- 20261024_usage_api_cost.sql
-- Keep what each AI run would have cost on the Claude API, for per-app billing.
--
-- Why: the Director bills each app monthly at "API price minus a per-client
-- discount" (decided 24 Oct 2026). The JICATE worker already sends, per run,
-- usage.api_cost_usd (Claude CLI's total_cost_usd: list API price, all models,
-- cache included; we pay nothing extra on the Max plan), cache_read_tokens and
-- cache_write_tokens (PR #76). Until now /complete dropped them.
--
--   ai_usage.api_cost_usd        USD the API would have charged for this run
--   ai_usage.cache_read_tokens   prompt-cache reads of the model that answered
--   ai_usage.cache_write_tokens  prompt-cache writes of the model that answered
--   ai_usage.account             Claude account label the run used ('default' =
--                                the box's own sign-in), for the usage page
--   ai_usage.application_id      copied from the job, so a bill can group by app
--   ai_usage.is_test             copied from the job: a test run from the task
--                                builder (billed to the app, per the Director)
--   ai_jobs.is_test              set by whoever queues a test run; default false
--
-- fn_ai_engine_complete gains four optional params (all DEFAULT NULL), so a
-- caller that sends only the old ten keeps working. The old ten-argument
-- version is dropped in the same transaction, so PostgREST never sees two
-- candidates for one call.
--
-- Additive only (new nullable / defaulted columns; the backfill touches only
-- the new application_id column). Safe to run twice.

BEGIN;

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS api_cost_usd       numeric(12,6) CHECK (api_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS cache_read_tokens  integer CHECK (cache_read_tokens >= 0),
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer CHECK (cache_write_tokens >= 0),
  ADD COLUMN IF NOT EXISTS account            text,
  ADD COLUMN IF NOT EXISTS application_id     uuid,
  ADD COLUMN IF NOT EXISTS is_test            boolean NOT NULL DEFAULT false;

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

UPDATE public.ai_usage u
   SET application_id = j.application_id
  FROM public.ai_jobs j
 WHERE j.id = u.job_id AND u.application_id IS NULL AND j.application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_usage_app_invoked_idx ON public.ai_usage (application_id, invoked_at);

DROP FUNCTION IF EXISTS public.fn_ai_engine_complete(uuid, text, boolean, jsonb, text, boolean, text, int, int, int);

CREATE OR REPLACE FUNCTION public.fn_ai_engine_complete(
  p_job_id uuid,
  p_runner text,
  p_ok boolean,
  p_result jsonb,
  p_error text,
  p_retry boolean DEFAULT false,
  p_model_id text DEFAULT NULL,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_api_cost_usd numeric DEFAULT NULL,
  p_cache_read_tokens integer DEFAULT NULL,
  p_cache_write_tokens integer DEFAULT NULL,
  p_account text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  j public.ai_jobs%ROWTYPE;
  next_status text;
BEGIN
  SELECT * INTO j FROM public.ai_jobs
   WHERE id = p_job_id AND status = 'running' AND claimed_by = p_runner
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_claimed_by_runner');
  END IF;

  INSERT INTO public.ai_usage (job_id, job_type, app_slug, organization_id, application_id, runner,
                               model_id, input_tokens, output_tokens, cost_inr,
                               duration_ms, success, error_message,
                               api_cost_usd, cache_read_tokens, cache_write_tokens, account, is_test)
  VALUES (j.id, j.job_type, j.app_slug, j.organization_id, j.application_id, p_runner,
          p_model_id, p_input_tokens, p_output_tokens, 0,
          p_duration_ms, p_ok, CASE WHEN p_ok THEN NULL ELSE left(p_error, 1000) END,
          p_api_cost_usd, p_cache_read_tokens, p_cache_write_tokens, left(p_account, 40), j.is_test);

  IF p_ok THEN
    UPDATE public.ai_jobs
       SET status = 'done', result = p_result, error = NULL, completed_at = now()
     WHERE id = j.id;
    RETURN jsonb_build_object('ok', true, 'status', 'done');
  END IF;

  next_status := CASE WHEN p_retry AND j.attempts < 3 THEN 'queued' ELSE 'error' END;
  UPDATE public.ai_jobs
     SET status = next_status,
         error = left(p_error, 1000),
         claimed_by = CASE WHEN next_status = 'queued' THEN NULL ELSE claimed_by END,
         claimed_at = CASE WHEN next_status = 'queued' THEN NULL ELSE claimed_at END,
         completed_at = CASE WHEN next_status = 'error' THEN now() ELSE NULL END
   WHERE id = j.id;
  RETURN jsonb_build_object('ok', true, 'status', next_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_engine_complete(uuid, text, boolean, jsonb, text, boolean, text, int, int, int, numeric, int, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_engine_complete(uuid, text, boolean, jsonb, text, boolean, text, int, int, int, numeric, int, int, text) TO service_role;

COMMIT;
