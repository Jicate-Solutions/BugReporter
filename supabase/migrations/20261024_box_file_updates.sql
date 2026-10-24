-- 20261024_box_file_updates.sql
-- Worker-file updates for the Windows boxes, delivered by the box agent.
--
-- Why: on Box 2 the JICATE workers run as S4U tasks in session 0, so a Claude
-- tab cannot stop or restart them without Windows admin (a UAC click per
-- update). The box agent (jicate-box-agent.mjs) runs as the same user in the
-- same mode and already restarts the workers. It now also installs a new
-- worker file published here, waits until no JICATE job is running, swaps the
-- file, restarts the workers and checks they come back (else it rolls back).
--
--   ai_box_files   one row per file the agent may install. ONLY the worker
--                  file is allowed; the agent never updates itself.
--     sha256       hex SHA-256 of the exact file bytes (= UTF-8 of content)
--     signature    base64 Ed25519 signature over the same bytes. The agent
--                  verifies it with a public key kept in box-agent.json on the
--                  box, so a database write alone cannot run code on a box.
--     source       where it came from (commit sha), for the record.
--   ai_boxes.files_applied   { "<name>": "<sha256>" } the agent reports after
--                  a swap passed its health check.
--
-- Writes: service role only (no write policy; writes revoked from
-- authenticated and anon). Super admins may read.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.ai_box_files (
  name        text PRIMARY KEY CHECK (name IN ('jicate-ai-drain.mjs')),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  signature   text NOT NULL CHECK (signature ~ '^[A-Za-z0-9+/]{86}==$'),
  content     text NOT NULL,
  source      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_box_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_box_files_super_admin_read ON public.ai_box_files;
CREATE POLICY ai_box_files_super_admin_read ON public.ai_box_files
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));
REVOKE ALL ON public.ai_box_files FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_box_files FROM authenticated;

ALTER TABLE public.ai_boxes ADD COLUMN IF NOT EXISTS files_applied jsonb;
