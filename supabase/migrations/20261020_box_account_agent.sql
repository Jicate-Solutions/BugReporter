-- 20261020_box_account_agent.sql
-- Box-wide Claude account, chosen in the Control Tower (Director, 2026-10-20:
-- "all controls on the Windows box from the Control Tower itself").
--
-- One row per Windows computer. A small agent on the box (jicate-box-agent.mjs)
-- asks once a minute which account the box should use and applies it to the
-- WHOLE box: it sets the user environment variable CLAUDE_CODE_OAUTH_TOKEN (so
-- every newly started Claude on that box — MyJKKN's workers, the Claude tabs —
-- uses that account) and restarts a list of tasks the box itself configured.
--
--   account        'auto' | an account label | NULL (no override: the box's own sign-in)
--   chosen_label   what 'auto' resolved to last (NULL = the box's own sign-in)
--   applied_label  what the agent reports it has applied; applied_at, agent_seen_at
--
-- The agent authenticates with its own box-generated token (sha256 only here),
-- separate from the runner tokens, so a worker token never gets box-wide keys.
-- Every key the agent receives is logged in ai_account_key_fetches.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_boxes (
  host            text PRIMARY KEY,
  account         text CHECK (account IS NULL OR account ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  chosen_label    text,
  applied_label   text,
  applied_at      timestamptz,
  agent_seen_at   timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_box_agent_tokens (
  host          text NOT NULL,
  token_sha256  text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_box_agent_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_boxes_super_admin_read ON public.ai_boxes;
CREATE POLICY ai_boxes_super_admin_read ON public.ai_boxes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));
REVOKE ALL ON public.ai_boxes, public.ai_box_agent_tokens FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_boxes FROM authenticated;
REVOKE ALL ON public.ai_box_agent_tokens FROM authenticated;
