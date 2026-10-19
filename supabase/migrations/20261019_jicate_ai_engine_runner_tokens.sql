-- 20261019_jicate_ai_engine_runner_tokens.sql
-- Runner credentials for the JICATE AI engine, stored as SHA-256 hashes only.
--
-- Each worker on the JICATE Windows box generates its own random token ON THE
-- BOX and sends only the hash here. The token itself never travels: not in a
-- chat, not in a message, not in Vercel. The runner routes hash the bearer
-- token they receive and look it up. A token is bound to one runner name, so a
-- token can only ever claim and complete jobs as that runner.
--
-- Revoke = set revoked_at. Rotate = insert a new row, revoke the old one.
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_runner_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner        text NOT NULL CHECK (runner ~ '^[A-Za-z0-9._-]{1,64}$'),
  token_sha256  text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_runner_tokens_live_runner_uniq
  ON public.ai_runner_tokens (runner) WHERE revoked_at IS NULL;

-- Service role only: RLS on, no policies.
ALTER TABLE public.ai_runner_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_runner_tokens FROM anon, authenticated;
