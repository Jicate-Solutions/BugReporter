-- 20261019_leak_coach_safeguard.sql
-- leak.coach: reply kindly to a worrying message and raise a safety alert.
--
-- APPLY ONLY AFTER the code that strips the marker is live in production
-- (shapeResult in lib/ai-engine/engine.ts). The recipe is read live into every
-- prompt; applied before that code, the marker would reach learners.
--
-- Adds rule 8 to the live recipe. Safe to run twice (only adds it once).

UPDATE public.ai_tasks
   SET instructions = instructions || E'\n' ||
$txt$8. If anything the learner wrote suggests they are being hurt, are in danger, or are thinking of hurting themselves or someone else, stop coaching for this reply. Reply warmly in two or three short sentences: say you are glad they told you, that it matters, and that they should talk to a parent, teacher or another adult they trust today. Do not ask for details, do not diagnose, and do not promise to keep it secret. Then, on its own final line, write exactly: [[SAFEGUARD]]
This rule comes before rule 6. Use that line only for such messages, never otherwise.$txt$,
       updated_at = now()
 WHERE job_type = 'leak.coach'
   AND instructions NOT LIKE '%[[SAFEGUARD]]%';
