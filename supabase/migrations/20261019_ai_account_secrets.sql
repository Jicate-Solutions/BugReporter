-- 20261019_ai_account_secrets.sql
-- Claude account keys kept in the Control Tower (Director, 2026-10-19: "paste
-- in Control Tower, simple"). The Director pastes each account's long-lived key
-- (from `claude setup-token`) once on the AI Routines page; every JICATE worker
-- fetches the key for the account it is told to use.
--
-- Stored ENCRYPTED (AES-256-GCM) with one master key held only in the
-- Control Tower's server settings (AI_ACCOUNT_KEY_SECRET). Accepted risk, chosen
-- by the Director: someone who gets both the database and that setting, or a
-- worker's runner token, can use these accounts.
--
-- No row-level policies: only the server (service role) reads or writes this.
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_account_secrets (
  label       text PRIMARY KEY REFERENCES public.ai_accounts(label) ON DELETE CASCADE,
  ciphertext  text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    uuid
);

ALTER TABLE public.ai_account_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_account_secrets FROM anon, authenticated;

-- Every key handed to a worker, so the Director can see who fetched what.
CREATE TABLE IF NOT EXISTS public.ai_account_key_fetches (
  id          bigserial PRIMARY KEY,
  runner      text NOT NULL,
  label       text NOT NULL,
  job_id      uuid,
  host        text,
  granted     boolean NOT NULL,
  reason      text,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_account_key_fetches_at_idx ON public.ai_account_key_fetches (fetched_at DESC);
ALTER TABLE public.ai_account_key_fetches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_account_key_fetches_super_admin_read ON public.ai_account_key_fetches;
CREATE POLICY ai_account_key_fetches_super_admin_read ON public.ai_account_key_fetches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));
REVOKE ALL ON public.ai_account_key_fetches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_account_key_fetches FROM authenticated;
