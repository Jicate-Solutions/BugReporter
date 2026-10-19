-- 20261019_jicate_ai_engine_leak_coach_fit.sql
-- Fit leak.coach to what the Plug the Leak app actually sends (read from its
-- app/api/coach/route.ts on 2026-10-19):
-- 1. The app sends language: "auto". Rule 3 said "if language is given, use it",
--    which could read "auto" as a language name. Now "auto" or missing = detect.
-- 2. The app caps the payload at 30,000 JS characters; the engine counts UTF-8
--    bytes, and Tamil/Hindi characters are 3 bytes each. 32 KB would refuse a
--    long Tamil workbook the app had accepted. 128 KB covers 30,000 characters
--    of any script.
-- Safe to run twice.
UPDATE public.ai_tasks
   SET instructions = replace(
         instructions,
         '3. Reply in the learner''s language. If "language" is given, use it. Otherwise use the language of their answers or question. If unsure, use English.',
         '3. Reply in the learner''s language. If "language" names a language, use it. If it is missing or "auto", use the language of their answers or question. If unsure, use English.'),
       max_payload_bytes = GREATEST(max_payload_bytes, 131072),
       updated_at = now()
 WHERE job_type = 'leak.coach';
