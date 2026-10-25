-- 20261025_intent_app_into_tower.sql
-- Interviews into the Control Tower, step 1 (Tower side only).
-- Plan: reports/interviews-into-tower-plan.html. Director, 25 Oct 2026 12:39 IST:
-- the Tower TRUSTS the intent app's finished prompts for now; the
-- interview-question prompt moves into a Tower recipe within a month.
--
-- What this adds:
--   ai_tasks.app_prompt        the app sends its own finished prompt (payload.prompt)
--                              and system prompt (payload.system); pass them through
--                              instead of fencing them as untrusted data. Default OFF.
--                              Not a recipe field: the task builder cannot set it.
--   ai_app_prompt_trust        the apps allowed to use app_prompt at all. Service
--                              role only. A task's app_prompt works ONLY for jobs
--                              from its own owner_app, and only when that app is
--                              listed here (lib/ai-engine/engine.ts appPromptAllowed).
--   ai_tasks.reuse_done_hours  re-use a finished answer: a request whose dedupe key
--                              AND payload match a DONE job of the same app and task,
--                              finished within this many hours (and after the recipe
--                              last changed), gets that job instead of a new run.
--                              NULL = OFF (default). Failed jobs and test runs are
--                              never re-used (engine.ts findReusableAnswer).
--   the intent interview app   registered as a Tower app, AI switched OFF.
--   19 intent.* tasks          all switched OFF.
--
-- What this does NOT do: no worker cap / reserved worker for interview jobs
-- (Director: no cap), no Mac backup worker (a later PR), nothing on the intent
-- app side (step 2). demo.ping is not moved (the Tower has system.account_probe).
--
-- No secret in this file. The app's API key is generated here by the database;
-- read it (or regenerate it) on the app's edit page in the Control Tower and put
-- it in the intent app's Vercel settings.
--
-- Additive only. Safe to run twice.
--
-- Roll back (nothing else depends on these yet):
--   DELETE FROM public.ai_tasks WHERE job_type LIKE 'intent.%' AND NOT enabled;
--   DELETE FROM public.applications WHERE slug = 'intent-interview';  -- cascades the trust row
--   DROP TABLE IF EXISTS public.ai_app_prompt_trust;
--   DROP INDEX IF EXISTS public.ai_jobs_reuse_idx;
--   ALTER TABLE public.ai_tasks DROP COLUMN IF EXISTS app_prompt, DROP COLUMN IF EXISTS reuse_done_hours;

BEGIN;

-- ── 1. per-task settings ─────────────────────────────────────────────────────
ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS app_prompt boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS reuse_done_hours int;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_tasks_reuse_done_hours_check') THEN
    -- 90 days at most: ai_jobs rows (and their answers) are pruned after 90 days.
    ALTER TABLE public.ai_tasks
      ADD CONSTRAINT ai_tasks_reuse_done_hours_check
      CHECK (reuse_done_hours IS NULL OR reuse_done_hours BETWEEN 1 AND 2160);
  END IF;
END $$;

-- The re-use lookup: newest DONE job for (app, task, dedupe key).
CREATE INDEX IF NOT EXISTS ai_jobs_reuse_idx
  ON public.ai_jobs (app_slug, job_type, dedupe_key, completed_at DESC)
  WHERE status = 'done' AND dedupe_key IS NOT NULL;

-- ── 2. apps allowed to send their own prompts ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_app_prompt_trust (
  application_id uuid PRIMARY KEY REFERENCES public.applications(id) ON DELETE CASCADE,
  note           text NOT NULL DEFAULT '',
  granted_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_app_prompt_trust ENABLE ROW LEVEL SECURITY;

-- Super admins may look; nobody but the service role may write. Not kept in
-- applications.settings on purpose: app maintainers can edit that.
DROP POLICY IF EXISTS ai_app_prompt_trust_read ON public.ai_app_prompt_trust;
CREATE POLICY ai_app_prompt_trust_read ON public.ai_app_prompt_trust
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));

REVOKE ALL ON public.ai_app_prompt_trust FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_app_prompt_trust FROM authenticated;

-- ── 3. the intent interview app ──────────────────────────────────────────────
-- Same organisation and creator as Plug the Leak (the last app registered for AI,
-- 19 Oct); the creator becomes maintainer through trigger_auto_add_app_creator.
-- AI starts OFF with the 19 tasks on its menu; switching it on is step 2.
DO $$
DECLARE
  v_org     uuid;
  v_creator uuid;
BEGIN
  SELECT organization_id, created_by_user_id INTO v_org, v_creator
    FROM public.applications WHERE slug = 'plug-the-leak' LIMIT 1;
  IF v_org IS NULL OR v_creator IS NULL THEN
    RAISE EXCEPTION 'intent app seed: could not find the plug-the-leak app to copy its organisation and creator';
  END IF;

  INSERT INTO public.applications (organization_id, name, slug, api_key, created_by_user_id, app_url, settings)
  VALUES (
    v_org,
    'Intent Interview Platform',
    'intent-interview',
    -- br_ + 32 hex characters from a random UUID: made by the database, never written down.
    'br_' || replace(gen_random_uuid()::text, '-', ''),
    v_creator,
    'https://intent-interview-platform.vercel.app',
    jsonb_build_object('ai', jsonb_build_object(
      'enabled', false,
      'allowed_tasks', jsonb_build_array(
        'intent.interview_turn', 'intent.interview_training_problems', 'intent.interview_content_capabilities',
        'intent.validate_code', 'intent.validate_code_integrations', 'intent.validate_code_roles',
        'intent.validate_code_extras', 'intent.validate_report', 'intent.validate_followup_questions',
        'intent.validate_build_prompt', 'intent.generate_amendments', 'intent.extract_learnings',
        'intent.fetch_company_context', 'intent.review_spec_summary', 'intent.synthesize',
        'intent.deep_dive', 'intent.analyze_build', 'intent.build_learnings',
        'intent.review_classify_feedback')))
  )
  ON CONFLICT (organization_id, slug) DO NOTHING;
END $$;

INSERT INTO public.ai_app_prompt_trust (application_id, note)
SELECT id, 'Director 2026-10-25: trust the intent app''s finished prompts; interview-question prompt to move into a Tower recipe within a month.'
  FROM public.applications WHERE slug = 'intent-interview'
ON CONFLICT (application_id) DO NOTHING;

-- ── 4. the 19 intent tasks, all OFF ──────────────────────────────────────────
-- From intent_ai_job_types (intent DB, read 25 Oct): model sonnet, no tools,
-- template "{{prompt}}", max_inflight 3. Sizes and timeouts are about twice the
-- largest / slowest run in intent_ai_jobs (never-run types get room to grow).
-- The answer comes back as {answer: text}, uncapped, as the intent drain returns it.
-- The instructions below are used only if pass-through is not in force (flag off
-- or app not trusted): the reply is then a marker the app cannot mistake for an
-- answer.
INSERT INTO public.ai_tasks (job_type, title, description, instructions, model, output_format,
                             interactive, enabled, max_inflight, max_payload_bytes, timeout_seconds,
                             max_answer_words, required_inputs, owner_app, app_prompt, reuse_done_hours)
SELECT v.job_type, v.title, v.description,
       'Pass-through task: the intent interview app sends its own finished prompt and system prompt, and the Tower runs them as sent. If you are reading this, the pass-through is not in force. Reply with exactly: PASS_THROUGH_OFF',
       'sonnet', 'text', v.interactive, false, 3, v.max_bytes, v.timeout_s,
       NULL, ARRAY['prompt'], a.id, true, v.reuse_h
  FROM (VALUES
    -- person waiting (claimed first)
    ('intent.interview_turn',                  'Interview turn',                 'Picks the next interview question for the client.',            true,  131072, 120, NULL::int),
    ('intent.interview_training_problems',     'Interview training problems',    'Suggests training problems during the interview.',             true,   32768, 300, NULL),
    ('intent.interview_content_capabilities',  'Interview content capabilities', 'Suggests content capabilities during the interview.',          true,   32768, 300, NULL),
    -- group A, validation (the four validate_code types carry repeat keys today: re-use for 30 days)
    ('intent.validate_code',                   'Validate code',                  'Checks a built app''s code against the spec.',                 false, 262144, 240, 720),
    ('intent.validate_code_integrations',      'Validate code integrations',     'Checks the app''s outside integrations.',                      false,  65536, 180, 720),
    ('intent.validate_code_roles',             'Validate code roles',            'Checks the app''s user roles.',                                false,  65536, 180, 720),
    ('intent.validate_code_extras',            'Validate code extras',           'Checks extra features in the code.',                           false,  32768, 180, 720),
    ('intent.validate_report',                 'Validate report',                'Writes the validation report.',                                false, 262144, 300, NULL),
    ('intent.validate_followup_questions',     'Validate followup questions',    'Writes follow-up questions after validation.',                 false, 262144, 300, NULL),
    ('intent.validate_build_prompt',           'Validate build prompt',          'Checks a build prompt before use.',                            false, 262144, 300, NULL),
    -- group B, writing
    ('intent.generate_amendments',             'Generate amendments',            'Writes spec amendments from validation gaps.',                 false,  65536, 300, NULL),
    ('intent.extract_learnings',               'Extract learnings',              'Pulls lessons from a finished project.',                       false, 262144, 400, NULL),
    ('intent.fetch_company_context',           'Fetch company context',          'Summarises the client company.',                               false,  32768, 120, NULL),
    ('intent.review_spec_summary',             'Review spec summary',            'Summarises a spec for review.',                                false,  65536, 120, NULL),
    ('intent.synthesize',                      'Synthesize',                     'Turns interview answers into a spec.',                         false, 262144, 400, NULL),
    ('intent.deep_dive',                       'Deep dive',                      'Writes deeper follow-up questions.',                           false, 262144, 300, NULL),
    ('intent.analyze_build',                   'Analyze build',                  'Analyses a finished build.',                                   false, 262144, 400, NULL),
    ('intent.build_learnings',                 'Build learnings',                'Records lessons from a build.',                                false, 262144, 300, NULL),
    ('intent.review_classify_feedback',        'Review classify feedback',       'Sorts a client''s review feedback.',                           false,  65536, 120, NULL)
  ) AS v(job_type, title, description, interactive, max_bytes, timeout_s, reuse_h)
  CROSS JOIN (SELECT id FROM public.applications WHERE slug = 'intent-interview' LIMIT 1) a
ON CONFLICT (job_type) DO NOTHING;

COMMIT;
