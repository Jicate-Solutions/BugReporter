-- 2026-08-17 — Rate limiting for the public SDK API.
--
-- Why: on 2026-08-07 between 17:44:14 and 17:49:55 an actor inserted 269 fake
-- bug reports through POST /api/v1/public/bug-reports, peaking at 49 rows in a
-- single second. That endpoint is authenticated by an X-API-Key header only,
-- and that key is NEXT_PUBLIC_-prefixed, so it ships inside the client browser
-- bundle and is readable by anyone with devtools. The key is deliberately NOT
-- being rotated -- a NEXT_PUBLIC_ value is inherently public, so throttling
-- rather than secrecy is the real control.
--
-- Storage choice: the platform deploys to Vercel serverless (see vercel.json),
-- so an in-process in-memory counter would be per-instance and would silently
-- do almost nothing under real traffic. There is no Redis / Upstash / Vercel KV
-- dependency in package.json, so Postgres -- the store the API already writes
-- to on every request -- is the only shared counter available. Tradeoff: one
-- extra round trip per public write.
--
-- Additive only: creates one new table and one new function. Touches no
-- existing table, column, policy or row.

-- ---------------------------------------------------------------------------
-- Counter table
-- ---------------------------------------------------------------------------
-- One row per (bucket, fixed time window). bucket_key is a SHA-256 hex digest
-- computed in the application layer -- neither the API key nor the raw client
-- IP is ever stored here (the IP is personal data, and the key should not be
-- copied into a high-churn table even though it is public).
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key    text        NOT NULL,
  window_start  timestamptz NOT NULL,
  request_count integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Supports the housekeeping delete below.
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window
  ON public.api_rate_limits (window_start);

-- Service-role only: RLS on with NO policies. Only the public API routes
-- (service client) touch this table; nothing in the browser reads it.
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Atomic check-and-increment
-- ---------------------------------------------------------------------------
-- Two buckets are counted on every call and BOTH must be under their limit:
--
--   identity bucket = (application + client IP)  -- stops one machine flooding
--   key bucket      = (application)              -- stops IP rotation on one key
--
-- Either bucket alone is trivially defeated: one API key is shared by every
-- browser running that app, and one IP is defeated by rotating IPs while
-- reusing the key. Both together bound the total.
--
-- This must be a single statement per bucket. A read-then-write from the
-- application layer would race: 49 concurrent requests would each read 0, each
-- write 1, and all 49 would pass. INSERT .. ON CONFLICT DO UPDATE takes a row
-- lock and increments atomically, which is the entire point of doing this in
-- the database rather than in the route handler.
--
-- Fixed window (not sliding): the window start is now() floored to a multiple
-- of p_window_seconds, so it is computed identically by every concurrent
-- caller with no coordination. Known tradeoff: a burst straddling a window
-- boundary can land up to 2x the limit within a short span. That is acceptable
-- here -- the target is 49/second floods, not shaving the last few percent.
--
-- A blocked request still increments both counters. A rejected attempt is
-- still an attempt, and it keeps the function to one code path.
CREATE OR REPLACE FUNCTION public.fn_check_api_rate_limit(
  p_identity_bucket text,
  p_identity_limit  int,
  p_key_bucket      text,
  p_key_limit       int,
  p_window_seconds  int DEFAULT 60
)
RETURNS TABLE (
  allowed       boolean,
  scope         text,
  current_count int,
  limit_value   int,
  retry_after   int
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window_seconds int;
  v_window_start   timestamptz;
  v_identity_count int;
  v_key_count      int;
  v_retry_after    int;
BEGIN
  v_window_seconds := GREATEST(COALESCE(p_window_seconds, 60), 1);

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / v_window_seconds) * v_window_seconds
  );

  -- Seconds until the current window rolls over (never advertise 0).
  v_retry_after := GREATEST(
    1,
    ceil(
      extract(
        epoch FROM (
          v_window_start + make_interval(secs => v_window_seconds)
        ) - now()
      )
    )::int
  );

  INSERT INTO public.api_rate_limits (bucket_key, window_start, request_count)
  VALUES (p_identity_bucket, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1
  RETURNING public.api_rate_limits.request_count INTO v_identity_count;

  INSERT INTO public.api_rate_limits (bucket_key, window_start, request_count)
  VALUES (p_key_bucket, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1
  RETURNING public.api_rate_limits.request_count INTO v_key_count;

  -- Housekeeping: every row here is disposable once its window has passed.
  -- Done probabilistically inline so the table cannot grow without bound and
  -- no extra cron entry / route is needed for it. ~1 call in 200 pays the cost.
  IF random() < 0.005 THEN
    DELETE FROM public.api_rate_limits
     WHERE window_start < now() - interval '1 day';
  END IF;

  IF v_identity_count > p_identity_limit THEN
    RETURN QUERY SELECT false, 'identity'::text, v_identity_count,
                        p_identity_limit, v_retry_after;
  ELSIF v_key_count > p_key_limit THEN
    RETURN QUERY SELECT false, 'application'::text, v_key_count,
                        p_key_limit, v_retry_after;
  ELSE
    RETURN QUERY SELECT true, 'ok'::text, v_identity_count,
                        p_identity_limit, v_retry_after;
  END IF;
END;
$$;

-- Lock the RPC to service-role only (anon/authenticated must not call it --
-- a caller who could invoke this directly could burn another app's quota).
REVOKE EXECUTE ON FUNCTION public.fn_check_api_rate_limit(text, int, text, int, int)
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_check_api_rate_limit(text, int, text, int, int)
  TO service_role;
