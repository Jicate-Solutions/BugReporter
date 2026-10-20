-- 20260807_buildwise_routines_seed.sql
-- Seed the four BuildWise routine schedules for the "buildwise-cashflow" app in
-- the "jicate-solution" org. The routine kinds live in code
-- (lib/routines/registry.ts, mode 'direct'): each POSTs the app's own
-- /api/jobs/<name> endpoint over HTTPS and stores the returned summary — no AI
-- engine involved.
--
-- Locked platform decision: routines start PAUSED (enabled = false). An org
-- owner/admin flips them on from the Routines page.
--
-- Schedule semantics (per the dispatcher, fn_app_routine_claim_due):
--   minute_of_day  — UTC minutes since midnight; fires at the first */15 cron
--                    tick at/after it, once per UTC day.
--   days_of_week   — Postgres EXTRACT(DOW) at UTC: 0=Sunday .. 6=Saturday.
--
--   buildwise.cash-digest      daily      890 (14:50 UTC ≈ 20:20 IST)
--   buildwise.budget-watchdog  daily      905 (15:05 UTC ≈ 20:35 IST)
--   buildwise.anomaly-scan     Sundays    920 (15:20 UTC ≈ 20:50 IST)
--   buildwise.reconcile        Sundays    935 (15:35 UTC ≈ 21:05 IST)
--
-- Ids are resolved by slug, never hardcoded. If the org/app doesn't exist in the
-- target environment (fresh/local DB), the SELECT yields no rows and nothing is
-- inserted — safe everywhere. Re-running is a no-op via ON CONFLICT on the
-- partial unique index app_ai_routines_app_uniq.

INSERT INTO public.app_ai_routines
  (organization_id, application_id, routine_kind, enabled, days_of_week, minute_of_day)
SELECT o.id, a.id, v.kind, false, v.days, v.minute
FROM (
  VALUES
    ('buildwise.cash-digest',     '{0,1,2,3,4,5,6}'::int[], 890),
    ('buildwise.budget-watchdog', '{0,1,2,3,4,5,6}'::int[], 905),
    ('buildwise.anomaly-scan',    '{0}'::int[],             920),
    ('buildwise.reconcile',       '{0}'::int[],             935)
) AS v(kind, days, minute)
JOIN public.organizations o ON o.slug = 'jicate-solution'
JOIN public.applications  a ON a.organization_id = o.id AND a.slug = 'buildwise-cashflow'
ON CONFLICT (organization_id, application_id, routine_kind)
  WHERE application_id IS NOT NULL
  DO NOTHING;
