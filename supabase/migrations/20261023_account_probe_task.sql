-- 20261023_account_probe_task.sql
-- system.account_probe: a tiny check job that reads one Claude account's
-- 5-hour and weekly usage (Director 2026-10-23: the Control Tower must see how
-- full an account is every few minutes, and test an account before auto moves
-- a box onto it).
--
-- The ai-engine-watch cron queues one per account kept in the Control Tower
-- when its reading is over 15 minutes old (lib/ai-engine/accounts.ts,
-- enqueueAccountProbes). The claim route runs it on the account it names; the
-- answer is thrown away, the usage reading is kept.
--
-- Safe in either order with the code: until the code is live nobody queues it.
-- Add-only; safe to run twice.

INSERT INTO public.ai_tasks
  (job_type, title, description, instructions, model, output_format,
   interactive, enabled, max_inflight, max_payload_bytes, timeout_seconds, max_answer_words)
VALUES
  ('system.account_probe',
   'Account check',
   'Control Tower only: reads one Claude account''s usage so "auto" picks a box''s account on fresh numbers.',
   'This is a connection check. Reply with the single word: ok',
   'haiku', 'text',
   false, true, 2, 1024, 60, 10)
ON CONFLICT (job_type) DO NOTHING;
