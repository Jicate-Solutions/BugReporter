-- 20261019_ai_account_pool.sql
-- A pool of Claude accounts for the JICATE workers, with how much of each
-- account's allowance is used, so the Director can switch a Windows box to the
-- account with the most left (Director, 2026-10-19: "add 5 Claude accounts and
-- change them per Windows box as and when we want, based on remaining usage").
--
-- Every Claude call reports its account's 5-hour and 7-day usage; the worker
-- passes that on with each finished job. Readings are keyed by account label.
-- The SAME account must carry the SAME label on every box. "default" means the
-- box's own sign-in (today aicse on every box).
--
--   ai_runners.host   the Windows computer a worker runs on, so the AI Routines
--                     page can group workers by box.
--   account = 'auto'  the Tower picks, at each claim, the highest-priority
--                     account that still has allowance (both windows under
--                     95%, or already renewed). When it runs out the next one
--                     is used; when a higher one renews, workers switch back.
--                     Equal priority: the one with the lowest weekly usage.
--   ai_accounts.priority  1 = use first. NULL = after every numbered account.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_accounts (
  label                text PRIMARY KEY CHECK (label ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  five_hour_util       numeric,
  seven_day_util       numeric,
  five_hour_resets_at  timestamptz,
  seven_day_resets_at  timestamptz,
  overage_enabled      boolean,
  reported_by          text,
  updated_at           timestamptz,
  alerted_at           timestamptz,
  priority             int CHECK (priority IS NULL OR priority BETWEEN 1 AND 99)
);
ALTER TABLE public.ai_accounts ADD COLUMN IF NOT EXISTS priority int CHECK (priority IS NULL OR priority BETWEEN 1 AND 99);

ALTER TABLE public.ai_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_accounts_super_admin_read ON public.ai_accounts;
CREATE POLICY ai_accounts_super_admin_read ON public.ai_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));
REVOKE ALL ON public.ai_accounts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_accounts FROM authenticated;

ALTER TABLE public.ai_runners
  ADD COLUMN IF NOT EXISTS host text;
