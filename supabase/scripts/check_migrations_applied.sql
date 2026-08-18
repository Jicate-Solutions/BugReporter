-- =============================================
-- OPERATIONAL SCRIPT: which migrations are actually live?
-- =============================================
-- Run this in the Supabase SQL editor. It is NOT a migration --- it is
-- read-only and changes nothing, so it is safe to run at any time.
--
-- Why this exists: migrations here are applied by hand in the SQL editor, so
-- nothing records that a file was run. 20260814_client_verification_states sat
-- unapplied for three days while the code that depended on it was live, and the
-- only signal was a CHECK constraint violation in front of a client.
--
-- So this does not read a ledger --- it probes for each migration's EFFECT.
-- That is the stronger test anyway: it answers "is the database in the shape
-- this file describes", which stays true even if someone applied the change by
-- hand without the file, or ran the file against the wrong project.
--
-- APPLIED  --- every probe passed.
-- MISSING  --- no probe passed. Run the file.
-- PARTIAL  --- some passed. Do NOT blindly re-run; look at `probes` first and
--              work out which half landed, because a partially applied file
--              usually means it errored midway.
-- =============================================


-- =============================================
-- 1. THE LEDGER, IF THERE IS ONE
-- =============================================
-- Present only if the Supabase CLI has ever pushed to this project. Empty or
-- absent means everything was applied by hand, which is the case here. Shown
-- first so a future reader does not trust it without checking it exists.

SELECT
  CASE
    WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
      THEN 'No CLI ledger --- migrations are applied by hand. Section 2 is the truth.'
    ELSE 'CLI ledger exists --- but it only knows about `supabase db push`, not SQL-editor runs.'
  END AS ledger_status;


-- =============================================
-- 2. THE PROBES
-- =============================================

WITH checks AS (
  -- Portal groundwork: the events table, the reporter identity columns.
  SELECT
    '20260804_bug_status_portal' AS migration,
    'bug_status_events table + bug_reports.reporter_email + bug_report_messages.author_kind' AS probes,
    ARRAY[
      to_regclass('public.bug_status_events') IS NOT NULL,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'bug_reports'
                 AND column_name = 'reporter_email'),
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'bug_report_messages'
                 AND column_name = 'author_kind')
    ] AS parts

  UNION ALL

  -- Security fix. Existence is not enough --- the function is CREATE OR REPLACE,
  -- so an old copy has the same name. Probe the authorization check itself.
  SELECT
    '20260804_fix_super_admin_privilege_escalation',
    'add_super_admin_by_email() refuses a non-super-admin caller',
    ARRAY[
      COALESCE(
        (SELECT pg_get_functiondef(p.oid)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'add_super_admin_by_email'
          LIMIT 1
        ) LIKE '%Only super admins can grant super admin access%',
        false)
    ]

  UNION ALL

  -- Lets a reporter be recorded as the actor of a status change.
  SELECT
    '20260805_reporter_status_actor',
    'bug_status_events_actor_kind_check accepts ''reporter''',
    ARRAY[
      COALESCE(
        (SELECT pg_get_constraintdef(c.oid)
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'bug_status_events'
            AND c.conname = 'bug_status_events_actor_kind_check'
        ) LIKE '%reporter%',
        false)
    ]

  UNION ALL

  -- BUG-<n> numbering moved to a sequence after an int overflow.
  SELECT
    '20260810_fix_bug_display_id_overflow',
    'bug_display_id_seq sequence + set_bug_display_id trigger',
    ARRAY[
      to_regclass('public.bug_display_id_seq') IS NOT NULL,
      EXISTS (SELECT 1
                FROM pg_trigger tg
                JOIN pg_class t ON t.oid = tg.tgrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
               WHERE n.nspname = 'public' AND tg.tgname = 'set_bug_display_id'
                 AND NOT tg.tgisinternal)
    ]

  UNION ALL

  -- The one that was missing. Without it `closed` cannot be written at all.
  SELECT
    '20260814_client_verification_states',
    'bug_reports_status_check accepts ''ready_for_testing'' AND ''closed''',
    ARRAY[
      COALESCE((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'public' AND t.relname = 'bug_reports'
                   AND c.conname = 'bug_reports_status_check'
               ) LIKE '%ready_for_testing%', false),
      COALESCE((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'public' AND t.relname = 'bug_reports'
                   AND c.conname = 'bug_reports_status_check'
               ) LIKE '%closed%', false)
    ]
)
SELECT
  migration,
  CASE
    WHEN (SELECT bool_and(p) FROM unnest(parts) p) THEN 'APPLIED'
    WHEN (SELECT bool_or(p)  FROM unnest(parts) p) THEN 'PARTIAL --- read `probes`'
    ELSE 'MISSING --- run it'
  END AS status,
  (SELECT count(*) FROM unnest(parts) p WHERE p) || '/' || cardinality(parts) AS probes_passed,
  probes
FROM checks
ORDER BY migration;


-- =============================================
-- 3. THE STATUS CONSTRAINT, IN FULL
-- =============================================
-- The single most load-bearing line for the portal. Read it directly rather
-- than trusting the summary above.

SELECT pg_get_constraintdef(c.oid) AS bug_reports_status_check
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'bug_reports'
  AND c.conname = 'bug_reports_status_check';


-- =============================================
-- 4. WHAT THE DATA ACTUALLY HOLDS
-- =============================================
-- A cross-check on section 2: if `closed` or `ready_for_testing` appear here,
-- the constraint was widened at some point whatever the probes say.

SELECT status, count(*) AS bugs
FROM bug_reports
GROUP BY status
ORDER BY count(*) DESC;
