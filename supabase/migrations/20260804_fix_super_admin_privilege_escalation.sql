-- 20260804_fix_super_admin_privilege_escalation.sql
--
-- SECURITY FIX — privilege escalation to super admin.
--
-- Both functions below are SECURITY DEFINER and were reachable through the
-- public REST API by the `anon` role, with no authorization in the function
-- body. The anon key ships in every integrated application's browser bundle, so
-- in practice anyone could grant themselves platform-wide super admin — which
-- reads every organization's and every application's bug data.
--
--   add_super_admin_by_email(p_email, p_notes)
--     Had no authorization check whatsoever. The caller's session was only used
--     to fill `granted_by`, and it explicitly tolerated having no session at all
--     (`COALESCE(auth.uid(), v_user_id)`). The application DID check
--     isSuperAdmin() first (lib/services/super-admins/server.ts), but that is
--     application code — POSTing straight to /rest/v1/rpc/ bypassed it.
--
--   bootstrap_super_admin_if_needed(p_user_id, p_email, p_bootstrap_email)
--     Trusted all three caller-supplied arguments. The only check was
--     `p_email = p_bootstrap_email` — both attacker-controlled — so passing the
--     same string twice satisfied it, and `p_user_id` then decided who became
--     super admin.
--
-- Audited before fixing: 3 super admins, all legitimate, none self-granted.
-- No evidence of exploitation.
--
-- Signatures are unchanged so lib/services/super-admins/server.ts keeps working.

-- ── add_super_admin_by_email ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_super_admin_by_email(
  p_email text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_super_admin_id UUID;
  v_caller UUID := auth.uid();
BEGIN
  -- Authorization now lives in the function, where a direct RPC call cannot
  -- skip it. A session must belong to an existing super admin; a sessionless
  -- call is only allowed from a privileged backend role (SQL editor /
  -- service_role), which is how the very first admin is created.
  IF v_caller IS NULL THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION 'Not authorized to grant super admin access';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM super_admins WHERE user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Only super admins can grant super admin access';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', p_email;
  END IF;

  SELECT id INTO v_super_admin_id FROM super_admins WHERE user_id = v_user_id;

  IF v_super_admin_id IS NOT NULL THEN
    RETURN v_super_admin_id;
  END IF;

  INSERT INTO super_admins (user_id, granted_by, notes)
  VALUES (v_user_id, COALESCE(v_caller, v_user_id), p_notes)
  RETURNING id INTO v_super_admin_id;

  RETURN v_super_admin_id;
END;
$function$;

-- ── bootstrap_super_admin_if_needed ──────────────────────────────────────────
-- Can now only ever promote the authenticated caller, and only while NO super
-- admin exists — which is what "bootstrap" means. With admins already present
-- it is inert.
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin_if_needed(
  p_user_id uuid,
  p_email text,
  p_bootstrap_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID := auth.uid();
  v_real_email TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM super_admins) THEN
    RETURN FALSE;
  END IF;

  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_user_id THEN
    RETURN FALSE;
  END IF;

  -- Read the email from auth.users rather than believing the caller.
  SELECT email INTO v_real_email FROM auth.users WHERE id = v_caller;
  IF v_real_email IS NULL OR v_real_email IS DISTINCT FROM p_bootstrap_email THEN
    RETURN FALSE;
  END IF;

  INSERT INTO super_admins (user_id, granted_by, notes)
  VALUES (v_caller, v_caller, 'Auto-created from bootstrap email on first login');

  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to bootstrap super admin: %', SQLERRM;
    RETURN FALSE;
END;
$function$;

-- Defence in depth. `authenticated` keeps EXECUTE because the dashboard calls
-- these with a user session — the in-function checks above are what authorize.
REVOKE EXECUTE ON FUNCTION public.add_super_admin_by_email(text, text)
  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin_if_needed(uuid, text, text)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_super_admin_by_email(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin_if_needed(uuid, text, text)
  TO authenticated, service_role;
