-- 20261019_jicate_ai_engine_claim_drains_off_tasks.sql
-- Switching a task OFF must not strand jobs already queued on the JICATE engine.
-- The first version of fn_ai_engine_claim only handed out jobs whose task was
-- switched on, so a job queued just before the switch was flipped would never
-- be claimed and never fail: the app would wait until it gave up. Intake is
-- already gated in fn_ai_engine_enqueue (an OFF task takes no new jobs), so the
-- claim no longer filters on enabled: whatever is already queued drains.
-- Same signature, CREATE OR REPLACE. Safe to run twice.

CREATE OR REPLACE FUNCTION public.fn_ai_engine_claim(p_runner text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j public.ai_jobs%ROWTYPE;
  t public.ai_tasks%ROWTYPE;
BEGIN
  -- One claimer at a time: makes the max_inflight count exact.
  PERFORM pg_advisory_xact_lock(hashtext('fn_ai_engine_claim'));

  INSERT INTO public.ai_runners (name, last_seen_at) VALUES (p_runner, now())
  ON CONFLICT (name) DO UPDATE SET last_seen_at = now();

  -- Stale claims: give up after 3 attempts, otherwise put back in the queue.
  UPDATE public.ai_jobs s
     SET status = CASE WHEN s.attempts >= 3 THEN 'error' ELSE 'queued' END,
         error  = CASE WHEN s.attempts >= 3 THEN 'timed out 3 times' ELSE s.error END,
         completed_at = CASE WHEN s.attempts >= 3 THEN now() ELSE NULL END,
         claimed_by = NULL, claimed_at = NULL
    FROM public.ai_tasks st
   WHERE st.job_type = s.job_type
     AND s.status = 'running'
     AND s.claimed_at < now() - make_interval(secs => st.timeout_seconds * 2 + 60);

  SELECT q.* INTO j
    FROM public.ai_jobs q
    JOIN public.ai_tasks qt ON qt.job_type = q.job_type
   WHERE q.status = 'queued'
     AND (SELECT count(*) FROM public.ai_jobs r
           WHERE r.job_type = q.job_type AND r.status = 'running') < qt.max_inflight
   ORDER BY q.interactive DESC, q.priority, q.requested_at
   LIMIT 1
   FOR UPDATE OF q SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('job', NULL, 'spec', NULL);
  END IF;

  UPDATE public.ai_jobs
     SET status = 'running', claimed_by = p_runner, claimed_at = now(),
         attempts = attempts + 1
   WHERE id = j.id
  RETURNING * INTO j;

  UPDATE public.ai_runners SET last_job_at = now() WHERE name = p_runner;

  SELECT * INTO t FROM public.ai_tasks WHERE job_type = j.job_type;

  RETURN jsonb_build_object(
    'job', jsonb_build_object(
      'id', j.id, 'job_type', j.job_type, 'app_slug', j.app_slug,
      'attempts', j.attempts, 'payload', j.payload, 'interactive', j.interactive),
    'spec', jsonb_build_object(
      'instructions', t.instructions, 'model', t.model,
      'output_format', t.output_format, 'timeout_seconds', t.timeout_seconds,
      'max_answer_words', t.max_answer_words)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ai_engine_claim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_engine_claim(text) TO service_role;
