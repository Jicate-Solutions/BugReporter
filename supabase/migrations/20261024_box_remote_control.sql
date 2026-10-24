-- 20261024_box_remote_control.sql
-- Remote control of the Windows boxes from the Control Tower (Director,
-- 2026-10-24: "fix this all once for all"). After one last install per box,
-- every change to a box flows through signed rows here, handled by the
-- always-on box agent (jicate-box-agent.mjs). No Claude tab, no paste, no UAC.
--
-- 1. ai_box_files may now carry every file the agent installs, not only the
--    worker: the agent itself (staged as .new, swapped by its launcher), the
--    mail client, the .cmd launchers and the task XMLs used by register-task.
-- 2. ai_box_commands: one row per command for one box.
--      box        = ai_boxes.host (no foreign key: a command may be queued for
--                   a box before it first checks in; it then waits or expires)
--      payload    = the exact signed bytes (UTF-8 JSON
--                   {id, box, verb, args, expires_at}, keys in that order)
--      signature  = base64 Ed25519 over payload, made on the Mac with the same
--                   key as ai_box_files. The agent trusts ONLY the payload; the
--                   other columns are an index for the Tower.
--      expires_at at most 6 hours after created_at.
--    status: queued -> running -> done | failed | refused, or queued -> expired
--    (set by the Tower when the box asks and the row is past expires_at).
-- 3. ai_boxes.status_report / status_at: the agent's status report (every
--    5 minutes and on a `status` command). Same read rule as the rest of
--    ai_boxes: super admins only.
--
-- Writes: service role only (no write policy; writes revoked from
-- authenticated and anon). Super admins may read.
--
-- Additive only. Safe to run twice.

-- 1. Widen the allow-list on ai_box_files.name (constraint name confirmed on
--    the live database: ai_box_files_name_check).
ALTER TABLE public.ai_box_files DROP CONSTRAINT IF EXISTS ai_box_files_name_check;
ALTER TABLE public.ai_box_files ADD CONSTRAINT ai_box_files_name_check CHECK (name IN (
  'jicate-ai-drain.mjs',
  'jicate-box-agent.mjs',
  'jicate-mail.mjs',
  'run-jicate-ai-drain.cmd',
  'run-jicate-box-agent.cmd',
  'ai.jicate.engine-1.xml',
  'ai.jicate.engine-2.xml',
  'ai.jicate.engine-3.xml',
  'ai.jicate.engine-4.xml',
  'ai.jicate.box-agent.xml'
));

-- 2. Commands.
CREATE TABLE IF NOT EXISTS public.ai_box_commands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box          text NOT NULL,
  verb         text NOT NULL CHECK (verb IN ('status', 'restart-task', 'register-task', 'run-script')),
  payload      text NOT NULL,
  signature    text NOT NULL CHECK (signature ~ '^[A-Za-z0-9+/]{86}==$'),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'done', 'failed', 'refused', 'expired')),
  result       jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  CONSTRAINT ai_box_commands_expiry_cap CHECK (expires_at - created_at <= interval '6 hours')
);

-- The agent asks once a minute for its queued rows.
CREATE INDEX IF NOT EXISTS ai_box_commands_box_status_idx
  ON public.ai_box_commands (box, status, expires_at);

ALTER TABLE public.ai_box_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_box_commands_super_admin_read ON public.ai_box_commands;
CREATE POLICY ai_box_commands_super_admin_read ON public.ai_box_commands
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));
REVOKE ALL ON public.ai_box_commands FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_box_commands FROM authenticated;

-- 3. Status report on the box row (ai_boxes is already super-admin read only,
--    writes revoked from authenticated and anon: see 20261020_box_account_agent.sql).
ALTER TABLE public.ai_boxes ADD COLUMN IF NOT EXISTS status_report jsonb;
ALTER TABLE public.ai_boxes ADD COLUMN IF NOT EXISTS status_at timestamptz;
