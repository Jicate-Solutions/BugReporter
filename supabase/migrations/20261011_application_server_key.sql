-- A second, server-only key per application, for the email-scoped reporter
-- routes.
--
-- The X-API-Key is shipped to browsers as NEXT_PUBLIC_*, so it identifies the
-- application and nothing about the person calling. Five public routes
-- (/me, /:id, /:id/messages, /:id/status, /stats) trusted it plus a
-- caller-supplied reporter_email, so anyone who knew a colleague's address could
-- read that colleague's bugs (screenshots, attachments, team replies) and write
-- notes or change status in their name.
--
-- Those routes now also require X-Server-Key (lib/middleware/server-key-auth.ts).
-- This file adds where its hash lives and how one is issued.
--
--   server_key_hash   SHA-256 hex of the key. The plaintext is never stored.
--                     NULL means "no server key": the guarded routes refuse
--                     every call for that app (fail closed).
--
--   fn_issue_app_server_key(org_slug, app_slug)
--                     Generates a key, stores its hash, returns the plaintext
--                     ONCE. Calling it again rotates: the old key stops working
--                     immediately. service_role only.
--
-- Prefix `brs_` (BugReporter Server key) keeps it visually distinct from the
-- public `br_` key so the two cannot be confused in an env file.
--
-- Until this file is applied the column does not exist, the lookup errors, and
-- every guarded route answers 401. That is the safe direction. Submitting bugs
-- (POST /api/v1/public/bug-reports) does not read this column and is unaffected.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS server_key_hash text;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_server_key_hash_format;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_server_key_hash_format
  CHECK (server_key_hash IS NULL OR server_key_hash ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.applications.server_key_hash IS
  'SHA-256 hex of the app''s server-only key (X-Server-Key). Issue with fn_issue_app_server_key. NULL = email-scoped reporter routes refuse all calls.';

-- Keyed on (org slug, app slug) because applications are UNIQUE(organization_id,
-- slug): an app slug alone can match more than one row.
--
-- Randomness: two gen_random_uuid() values (built in, ~244 random bits) rather
-- than pgcrypto's gen_random_bytes, so the function does not depend on which
-- schema an extension happens to live in.
CREATE OR REPLACE FUNCTION public.fn_issue_app_server_key(
  p_org_slug text,
  p_app_slug text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app_id uuid;
  v_count  integer;
  v_key    text;
BEGIN
  SELECT count(*), min(a.id::text)::uuid
    INTO v_count, v_app_id
    FROM public.applications a
    JOIN public.organizations o ON o.id = a.organization_id
   WHERE o.slug = p_org_slug
     AND a.slug = p_app_slug;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No application % in organization %', p_app_slug, p_org_slug;
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'More than one application % in organization %', p_app_slug, p_org_slug;
  END IF;

  v_key := 'brs_'
        || replace(gen_random_uuid()::text, '-', '')
        || replace(gen_random_uuid()::text, '-', '');

  UPDATE public.applications
     SET server_key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex'),
         updated_at      = now()
   WHERE id = v_app_id;

  RETURN v_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_issue_app_server_key(text, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_issue_app_server_key(text, text) TO service_role;
