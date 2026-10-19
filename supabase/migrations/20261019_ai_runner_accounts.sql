-- 20261019_ai_runner_accounts.sql
-- Choose which Claude account each JICATE worker uses, from the Control Tower.
--
-- The sign-ins never come here. Each extra Claude account is signed in ON the
-- Windows box once (claude setup-token); its long-lived key is saved there in a
-- file named after a short label (e.g. "acct2"). The worker reports which labels
-- it holds; the Control Tower stores only the labels and the choice:
--
--   account           label to use; NULL = the box's own sign-in ("default")
--   account_fallback  when the chosen account hits its limit (or its key stops
--                     working), try the worker's other accounts for that job
--   accounts_available  labels the worker reported having (default always works)
--   account_in_use    label the last job actually ran on
--
-- Additive only. Safe to run twice.

ALTER TABLE public.ai_runners
  ADD COLUMN IF NOT EXISTS account            text CHECK (account IS NULL OR account ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  ADD COLUMN IF NOT EXISTS account_fallback   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accounts_available text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS account_in_use     text;
