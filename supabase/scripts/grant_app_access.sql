-- =============================================
-- OPERATIONAL SCRIPT: Grant a user access to an application
-- =============================================
-- Run this in the Supabase SQL editor. It is NOT a migration --- do not move
-- it into supabase/migrations/, it must not re-run on a database rebuild.
--
-- Why this exists: application visibility is driven by `application_members`.
-- A user with only an `organization_members` row sees every bug in the org
-- (policy "members_view_bugs") but ZERO applications (policies
-- "members_view_apps" + "view_assigned_applications"). The embedded join
-- `application:applications(...)` then returns NULL for every bug, so the
-- Application column reads "Unknown" and the filter dropdown matches nothing.
--
-- Fill in the three values in section 1, then run sections top to bottom,
-- reading the output of each before moving on.
-- =============================================


-- =============================================
-- 1. PARAMETERS --- FILL THESE IN
-- =============================================
-- Reused by every section below via the `params` CTE.
--
--   target_email : the developer being granted access (e.g. Mahasri's login)
--   app_search   : matched against applications.name AND applications.slug
--   granter_email: the admin performing the grant, recorded in `added_by`.
--                  Leave NULL to fall back to the application's creator.

DROP VIEW IF EXISTS _grant_params;
CREATE TEMP VIEW _grant_params AS
SELECT
  'FILL_ME@jkkn.ac.in'::text AS target_email,   -- <<< developer's email
  'raagam'::text             AS app_search,     -- <<< app name or slug fragment
  NULL::text                 AS granter_email;  -- <<< your email, or leave NULL


-- =============================================
-- 2. PRE-FLIGHT: confirm the user exists and has cleared BOTH access gates
-- =============================================
-- Expect exactly ONE row. `approval_status` must be 'approved' and
-- `org_memberships` must be >= 1. If org_memberships is 0, this script alone
-- will NOT unblock them --- invite them to the org first
-- (Admin -> Organizations -> Team -> Invite members), because
-- app/auth/callback/route.ts routes unassigned users to /auth/waiting-access.

SELECT
  p.id AS user_id,
  p.email,
  p.full_name,
  ua.status AS approval_status,
  (SELECT count(*) FROM organization_members om WHERE om.user_id = p.id)
    AS org_memberships
FROM profiles p
LEFT JOIN user_approvals ua ON ua.user_id = p.id
CROSS JOIN _grant_params g
WHERE lower(p.email) = lower(g.target_email);


-- =============================================
-- 3. PRE-FLIGHT: confirm the application, and show who already has access
-- =============================================
-- Expect exactly ONE application row. If the search matches several, tighten
-- `app_search` in section 1 to the exact slug before continuing.

SELECT
  a.id AS application_id,
  a.name,
  a.slug,
  a.organization_id,
  a.created_by_user_id,
  (SELECT count(*) FROM application_members am WHERE am.application_id = a.id)
    AS current_members
FROM applications a
CROSS JOIN _grant_params g
WHERE a.name ILIKE '%' || g.app_search || '%'
   OR a.slug ILIKE '%' || g.app_search || '%';


-- =============================================
-- 4. THE GRANT
-- =============================================
-- Resolves both ids by lookup so no UUIDs need copying by hand. If either
-- lookup misses, this inserts 0 rows rather than erroring --- check the
-- "INSERT 0 N" count in the output, and re-run section 2/3 if N is 0.
--
-- Role 'developer' = bug CRUD, no member management (see the table comment on
-- application_members). Use 'maintainer' only if they should also be able to
-- grant access to others, or 'viewer' for read-only.

INSERT INTO application_members (application_id, user_id, role, added_by)
SELECT
  a.id,
  p.id,
  'developer',
  COALESCE(gp.id, a.created_by_user_id)
FROM _grant_params g
JOIN profiles p
  ON lower(p.email) = lower(g.target_email)
JOIN applications a
  ON a.name ILIKE '%' || g.app_search || '%'
  OR a.slug ILIKE '%' || g.app_search || '%'
LEFT JOIN profiles gp
  ON g.granter_email IS NOT NULL
 AND lower(gp.email) = lower(g.granter_email)
ON CONFLICT (application_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;


-- =============================================
-- 5. VERIFY
-- =============================================
-- Expect one row: the user, the application, and role 'developer'.
-- A page refresh is enough for this to take effect: application visibility is
-- enforced by RLS on every request, not by the one-time routing decision in
-- the OAuth callback. (Signing out and back in is only needed for the
-- approval and organization_members gates checked in section 2.)

SELECT
  p.email,
  p.full_name,
  a.name AS application,
  a.slug,
  am.role,
  am.added_at
FROM application_members am
JOIN profiles p ON p.id = am.user_id
JOIN applications a ON a.id = am.application_id
CROSS JOIN _grant_params g
WHERE lower(p.email) = lower(g.target_email);


-- Clean up the temp view (it is session-scoped and would otherwise linger).
DROP VIEW IF EXISTS _grant_params;
