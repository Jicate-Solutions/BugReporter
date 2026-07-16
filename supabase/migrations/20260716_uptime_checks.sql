-- 2026-07-16 — Phase 2 (uptime board): probe results, 7-day rolling history.
-- Director-approved 2026-07-16 ("Yes — create app_uptime_checks").
-- Service-role-only: RLS enabled with NO policies (org-gated server page + cron
-- use the service client; no browser reads).
CREATE TABLE IF NOT EXISTS public.app_uptime_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  status_code int,
  latency_ms int,
  error text
);
CREATE INDEX IF NOT EXISTS idx_uptime_checks_app_time
  ON public.app_uptime_checks (application_id, checked_at DESC);
ALTER TABLE public.app_uptime_checks ENABLE ROW LEVEL SECURITY;
