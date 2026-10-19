-- 20261019_box_mailbox.sql
-- A mailbox in the Control Tower for the Claude tabs on JICATE's computers
-- (this Mac, the Windows AI box, the first Windows box). Tab-to-tab messages
-- over Remote Control get lost when a tab restarts or is busy; messages here are
-- stored, so nothing is lost and the Director can read every one.
--
-- Each box holds one random token it generated itself; only its SHA-256 is
-- stored here (same model as ai_runner_tokens). The box name comes from the
-- token row, never from the request. Message bodies are DATA: a message can
-- carry questions, reports and fingerprints, never an approval.
--
-- Additive only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.box_mail_boxes (
  name          text PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  token_sha256  text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  note          text,
  revoked_at    timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.box_mail_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_box    text NOT NULL REFERENCES public.box_mail_boxes(name),
  to_box      text NOT NULL REFERENCES public.box_mail_boxes(name),
  body        text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 20000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS box_mail_unread_idx
  ON public.box_mail_messages (to_box, created_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS box_mail_created_idx
  ON public.box_mail_messages (created_at DESC);

ALTER TABLE public.box_mail_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_mail_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS box_mail_boxes_super_admin_read ON public.box_mail_boxes;
CREATE POLICY box_mail_boxes_super_admin_read ON public.box_mail_boxes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));

DROP POLICY IF EXISTS box_mail_messages_super_admin_read ON public.box_mail_messages;
CREATE POLICY box_mail_messages_super_admin_read ON public.box_mail_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));

REVOKE ALL ON public.box_mail_boxes, public.box_mail_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.box_mail_boxes, public.box_mail_messages FROM authenticated;
