-- 20261026_box_keys.sql
-- Box keys (Director, 2026-10-26: "Why not ok ui of jicate control tower").
-- The Director pastes a secret once on the Box keys page; the box agent on that
-- one box writes it into one env file as one variable, then reports delivered.
-- First and only target: DESKTOP-1LB1FCS, C:\jicate-ai\build-worker\build-worker.env,
-- BUILD_GITHUB_TOKEN.
--
-- target_id must be in the allow-list in lib/ai-engine/box-keys.ts; the Tower
-- never hands out a row whose target is not listed there, and the box agent
-- has its own copy of the list. A database row alone cannot aim a key at any
-- other file or variable.
--
-- ciphertext: sealed exactly like ai_account_secrets (AES-256-GCM, master key
-- AI_ACCOUNT_KEY_SECRET in the server settings). Never shown again after saving.
-- set_at doubles as the version: the agent echoes it when it reports, so a key
-- replaced while a delivery was in flight is not marked delivered by mistake.
-- delivered_at / delivery_error: what the agent reported for the current value.
-- A failed delivery is not retried until the Director saves the key again.
--
-- No row-level policies: only the server (service role) reads or writes this.
-- Every handout is logged in ai_account_key_fetches (runner box-agent@<host>,
-- label = target_id), next to the Claude account key handouts.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_box_keys (
  host            text NOT NULL,
  target_id       text NOT NULL CHECK (target_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  ciphertext      text NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  set_by          uuid,
  fetched_at      timestamptz,
  delivered_at    timestamptz,
  delivery_error  text CHECK (delivery_error IS NULL OR length(delivery_error) <= 200),
  PRIMARY KEY (host, target_id)
);

ALTER TABLE public.ai_box_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_box_keys FROM anon, authenticated;
