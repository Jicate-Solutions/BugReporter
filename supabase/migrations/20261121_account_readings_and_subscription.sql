-- 20261121_account_readings_and_subscription.sql
-- Two additions for the "Claude accounts" card on AI Routines (Director,
-- 2026-11-21): how fast each account's weekly allowance is being used, and
-- what each subscription costs and when it renews.
--
-- 1. ai_account_readings: a history of usage readings.
--    ai_accounts keeps only the LATEST reading per account, so the card could
--    not say how fast an account is filling up. From now on every reading the
--    Control Tower stores is also added here, from both places a reading
--    arrives: a worker reporting after a job
--    (app/api/internal/ai-engine/complete) and the Mac's feed
--    (app/api/internal/ai-engine/usage-reading). The card works out a pace and
--    a forecast from these rows (lib/ai-engine/account-pace.ts).
--    To keep it small, a reading with the same weekly and 5-hour values as the
--    account's newest row is not added again within 10 minutes.
--    label has no foreign key on purpose: nothing on ai_accounts changes.
--    No row-level policies: only the server (service role) reads or writes
--    this, like ai_account_secrets and ai_box_keys.
--
-- 2. Subscription details on ai_accounts, typed in by a platform admin on the
--    card (Claude does not report the next payment date or the amount):
--      plan_name                 e.g. "Max 20x"
--      subscription_started_on   the day the subscription started
--      billing_day               day of the month it renews (1 to 31), when known;
--                                otherwise the card estimates it from the start date
--      monthly_fee_inr           what it costs each month, in rupees
--      extra_usage_on            whether paid extra use is switched on
--      billing_note              a free note
--    All nullable, no defaults: no existing row is rewritten.
--
-- The page works before this is applied: it shows no pace and no subscription
-- line until the table and columns exist.
--
-- Additive only. Nothing existing is altered or dropped. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_account_readings (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label                text NOT NULL CHECK (label ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  five_hour_util       numeric,
  seven_day_util       numeric,
  five_hour_resets_at  timestamptz,
  seven_day_resets_at  timestamptz,
  reported_by          text,
  read_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_account_readings_label_read_at_idx
  ON public.ai_account_readings (label, read_at DESC);

ALTER TABLE public.ai_account_readings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_account_readings FROM anon, authenticated;

COMMENT ON TABLE public.ai_account_readings IS
  'History of Claude account usage readings (ai_accounts keeps only the latest). One row per reading stored, from a worker after a job or from the Mac feed; the AI Routines card works out pace and a forecast from it. Server (service role) only.';

ALTER TABLE public.ai_accounts
  ADD COLUMN IF NOT EXISTS plan_name text,
  ADD COLUMN IF NOT EXISTS subscription_started_on date,
  ADD COLUMN IF NOT EXISTS billing_day smallint CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS monthly_fee_inr numeric CHECK (monthly_fee_inr IS NULL OR monthly_fee_inr >= 0),
  ADD COLUMN IF NOT EXISTS extra_usage_on boolean,
  ADD COLUMN IF NOT EXISTS billing_note text;

COMMENT ON COLUMN public.ai_accounts.plan_name IS 'Subscription plan as the Director names it, e.g. "Max 20x". Typed in on the AI Routines card.';
COMMENT ON COLUMN public.ai_accounts.subscription_started_on IS 'The day this Claude subscription started. It renews by itself each month on that day unless billing_day says otherwise.';
COMMENT ON COLUMN public.ai_accounts.billing_day IS 'Day of the month the subscription renews (1 to 31), when known. NULL = estimated from subscription_started_on.';
COMMENT ON COLUMN public.ai_accounts.monthly_fee_inr IS 'What the subscription costs each month, in rupees.';
COMMENT ON COLUMN public.ai_accounts.extra_usage_on IS 'Whether paid extra use is switched on for this account. NULL = not known.';
COMMENT ON COLUMN public.ai_accounts.billing_note IS 'A free note about this subscription.';
