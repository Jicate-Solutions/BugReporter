-- 20261019_jicate_ai_engine_move_tasks.sql
-- Stage JICATE's existing AI tasks on the JICATE engine, SWITCHED OFF.
--
-- These five tasks run on MyJKKN's engine today. Their recipes are copied here
-- (wording adapted only to read the input from the fenced DATA block instead of
-- inline placeholders). While a row is OFF, the platform keeps sending that task
-- to MyJKKN exactly as before. Switching a row ON (AI Models page, platform
-- admins) moves that one task to the JICATE engine. Nothing is removed from
-- MyJKKN: Director, 2026-10-19 — not until the JICATE engine is proven and he
-- says so.
--
-- Also: required inputs. MyJKKN accepts a request with a missing required field
-- and the job then fails with "missing required input(s): …". The JICATE engine
-- now does the same (the job is created already failed), so an app sees the
-- identical 202-then-error behaviour whichever engine serves the task.
--
-- Additive: one new column with a default, a replaced function (same signature),
-- new rows. Safe to run twice.

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS required_inputs text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.fn_ai_engine_enqueue(
  p_job_type        text,
  p_application_id  uuid,
  p_app_slug        text,
  p_organization_id uuid,
  p_payload         jsonb,
  p_dedupe_key      text DEFAULT NULL,
  p_priority        int  DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t  public.ai_tasks%ROWTYPE;
  existing uuid;
  new_id uuid;
  missing text[];
  payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  SELECT * INTO t FROM public.ai_tasks WHERE job_type = p_job_type;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_task');
  END IF;
  IF NOT t.enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_switched_off');
  END IF;
  IF octet_length(payload::text) > t.max_payload_bytes THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payload_too_large',
                              'max_bytes', t.max_payload_bytes);
  END IF;

  -- A required input counts as missing when absent, null, or an empty/blank string.
  SELECT array_agg(k ORDER BY k) INTO missing
    FROM unnest(t.required_inputs) AS k
   WHERE NOT (payload ? k)
      OR jsonb_typeof(payload -> k) = 'null'
      OR (jsonb_typeof(payload -> k) = 'string' AND btrim(payload ->> k) = '');

  IF missing IS NOT NULL THEN
    -- Same contract as MyJKKN: accepted, then failed, with the reason on the poll.
    INSERT INTO public.ai_jobs (job_type, application_id, app_slug, organization_id,
                                payload, interactive, priority, status, error, completed_at)
    VALUES (p_job_type, p_application_id, p_app_slug, p_organization_id,
            payload, t.interactive, p_priority, 'error',
            'missing required input(s): ' || array_to_string(missing, ', '), now())
    RETURNING id INTO new_id;
    RETURN jsonb_build_object('ok', true, 'job_id', new_id, 'interactive', t.interactive);
  END IF;

  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO existing FROM public.ai_jobs
     WHERE app_slug = p_app_slug AND job_type = p_job_type
       AND dedupe_key = p_dedupe_key AND status IN ('queued', 'running')
     LIMIT 1;
    IF existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'job_id', existing,
                                'interactive', t.interactive, 'deduped', true);
    END IF;
  END IF;

  INSERT INTO public.ai_jobs (job_type, application_id, app_slug, organization_id,
                              payload, interactive, priority, dedupe_key)
  VALUES (p_job_type, p_application_id, p_app_slug, p_organization_id,
          payload, t.interactive, p_priority, p_dedupe_key)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'job_id', new_id, 'interactive', t.interactive);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ai_engine_enqueue(text, uuid, text, uuid, jsonb, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_engine_enqueue(text, uuid, text, uuid, jsonb, text, int) TO service_role;

-- leak.coach: the fields the coach cannot work without.
UPDATE public.ai_tasks
   SET required_inputs = '{mode,step,age_band}', updated_at = now()
 WHERE job_type = 'leak.coach' AND required_inputs = '{}';

-- The five tasks, staged OFF. Wording copied from MyJKKN's ai_job_types
-- (2026-10-19); only the inline {{placeholders}} became references to DATA.
INSERT INTO public.ai_tasks (job_type, title, description, instructions, model, output_format,
                             interactive, enabled, max_inflight, max_payload_bytes,
                             timeout_seconds, max_answer_words, required_inputs)
VALUES
(
  'bug.summarize',
  'Summarize a bug',
  'Plain-English summary + likely area + severity guess.',
  $txt$You are the bug-triage assistant for an application. Summarize this bug report in plain English for a busy developer.

DATA holds the report: app (the application), title (bug title), description, and context (extra context, may be empty).

Reply with exactly:
1. A 2-3 sentence plain-English summary.
2. One line "Likely area:" naming the probable module/feature.
3. One line "Severity guess:" one of low|medium|high|critical with a short reason.$txt$,
  'fable', 'text', true, false, 2, 65536, 120, NULL, '{title,description}'
),
(
  'bug.suggest_fix',
  'Suggest a fix',
  'Root-cause hypotheses + concrete fix steps.',
  $txt$You are a senior debugging assistant for an application. Analyze this bug and suggest how to fix it.

DATA holds the report: app (the application), title (bug title), description, and context (technical context: stack traces / console / network, may be empty).

Reply with exactly:
1. "Likely root cause:" 1-2 short hypotheses, most probable first.
2. "Suggested fix:" numbered steps, max 5, concrete.
3. "Verify after fixing:" one line on how to confirm the fix worked.$txt$,
  'fable', 'text', true, false, 2, 65536, 120, NULL, '{title,description}'
),
(
  'bug.categorize',
  'Categorize a bug',
  'Strict-JSON severity/category tags for machine use (returned as text in answer).',
  $txt$You are a bug classification engine. Classify this bug report.

DATA holds the report: app (the application), title (bug title), description, and context (extra context, may be empty).

Reply with STRICT JSON only, no prose, exactly this shape:
{"severity":"low|medium|high|critical","category":"ui|logic|performance|security|data|integration|other","module_guess":"<short module or feature name>","reason":"<one short sentence>"}$txt$,
  'fable', 'text', true, false, 2, 65536, 120, NULL, '{title,description}'
),
(
  'ops.brief',
  'Ops brief',
  'Reads the whole bug board and writes a plain-English manager briefing (status + priorities + risks).',
  $txt$You are the operations analyst for the JICATE Control Tower, briefing a busy engineering manager on the health of ALL applications at once (not a single bug).

DATA holds: org (the organization) and stats (today's fleet numbers).

Write a briefing with EXACTLY these three sections, nothing else:

"Where things stand:" 2-3 plain-English sentences on the overall state across all apps.

"Fix first:" a numbered list (max 4), most urgent first, each a one-line action with a reason grounded in the numbers in stats.

"Watch out for:" 1-3 bullets on risks or surprises only — open security bugs, a growing backlog, or bugs stuck too long. If nothing is concerning, write exactly: "Nothing alarming — the board looks healthy."

Cite the actual numbers. No preamble, no sign-off.$txt$,
  'sonnet', 'text', true, false, 1, 131072, 180, NULL, '{stats}'
),
(
  'reply.draft',
  'Reply — draft a corrected social reply (external)',
  'Rewrite a rejected Instagram/Facebook bot reply.',
  $txt$You are the social media voice of JKKN Educational Institutions (Tamil Nadu, India), replying on their Instagram and Facebook pages. A previous bot reply was rejected by a human reviewer — rewrite it so it would be approved.

DATA holds: app, comment (what the commenter said), bad_reply (the rejected reply), instruction (reviewer instruction, may be empty), and examples (approved examples for voice, may be empty).

Rules:
- Sound like a warm, real social-media manager, NOT a corporate desk.
- Match the commenter's language (English / Tamil / Tanglish) and energy; use emojis naturally.
- Keep it SHORT — 1 to 3 lines, like a real comment reply.
- For admissions / fees / courses / eligibility questions, include phone +91 9345855001 and email info@jkkn.ac.in.
- For greetings, praise, or casual banter, stay friendly and do NOT push contact details.
- Never invent facts (fees, dates, course names) that aren't given.
- If the reviewer gives an INSTRUCTION (e.g. 'need to reply positively', 'reply funny', 'its a bad word'), obey it and write the reply it asks for. NEVER repeat, quote or paraphrase the instruction itself — the reader must see a normal reply, not a note about one.
- If the comment is abusive or vulgar, do not argue or moralise: reply briefly, warmly and with dignity, and never repeat the offensive words.

Output ONLY the corrected reply text — no preamble, no quotes, no JSON.$txt$,
  'fable', 'text', false, false, 5, 32768, 120, NULL, '{comment,bad_reply}'
)
ON CONFLICT (job_type) DO NOTHING;
