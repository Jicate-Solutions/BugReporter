-- 20261118_ai_account_usage_daily.sql
-- Daily usage history per Claude account, for the "what we pay vs what we use"
-- page (Director, 18 Nov 2026). ai_accounts keeps only the latest reading, so
-- an average needs its own history.
--
-- One row per account per day (India time). Every usage reading the Tower
-- stores (a probe or job reading in /complete, a Mac reading in
-- /usage-reading) calls fn_ai_record_account_usage_day, which keeps the
-- HIGHEST reading of that day. The weekly window drops to 0 when it renews,
-- so the highest reading of a day keeps the level reached just before a
-- renewal instead of the 0 just after it.
--
-- Until this is applied, the writer quietly does nothing and the page says
-- "no history yet". Nothing else depends on it.
--
-- Additive only. Safe to run twice. Service role only (no row-level policies).

CREATE TABLE IF NOT EXISTS public.ai_account_usage_daily (
  label           text NOT NULL CHECK (label ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  day             date NOT NULL,
  seven_day_util  numeric CHECK (seven_day_util IS NULL OR seven_day_util >= 0),
  five_hour_util  numeric CHECK (five_hour_util IS NULL OR five_hour_util >= 0),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (label, day)
);

ALTER TABLE public.ai_account_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_account_usage_daily FROM anon, authenticated;

-- Record one reading. GREATEST ignores NULL, so a reading without a 5-hour
-- number never wipes the 5-hour number already stored for that day.
CREATE OR REPLACE FUNCTION public.fn_ai_record_account_usage_day(
  p_label text,
  p_seven numeric,
  p_five  numeric
) RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.ai_account_usage_daily (label, day, seven_day_util, five_hour_util, recorded_at)
  VALUES (p_label, (now() AT TIME ZONE 'Asia/Kolkata')::date, p_seven, p_five, now())
  ON CONFLICT (label, day) DO UPDATE SET
    seven_day_util = GREATEST(public.ai_account_usage_daily.seven_day_util, EXCLUDED.seven_day_util),
    five_hour_util = GREATEST(public.ai_account_usage_daily.five_hour_util, EXCLUDED.five_hour_util),
    recorded_at    = now();
$$;

REVOKE ALL ON FUNCTION public.fn_ai_record_account_usage_day(text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_record_account_usage_day(text, numeric, numeric) TO service_role;
