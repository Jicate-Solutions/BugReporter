-- 20261019_ai_task_effort.sql
-- Effort level per JICATE AI task, chosen on the AI Models page next to the
-- model (Director, 2026-10-19). NULL = the Claude CLI's own default. The worker
-- passes it as `claude -p --effort <level>`; a CLI too old to know the flag is
-- retried without it.
--
-- Additive only. Safe to run twice.

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS effort text
  CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high', 'xhigh', 'max'));
