-- 20261010_client_triage_lane.sql
-- An AI bug-triage lane that keeps every bug's text inside this database, and
-- the data boundary that keeps CLIENT apps' bug text out of MyJKKN.
--
-- Scope (Director, 10 Oct 2026, 18:10): the triage lane serves EVERY app in
-- the central reporter with settings.triage.enabled = true, whatever its
-- data_boundary. The client rule only blocks the MyJKKN AI Door.
--
-- Director rule (10 Oct 2026): bug text from client apps must never enter the
-- MyJKKN database, not even briefly. The AI Door (app/api/v1/public/ai/run,
-- app/api/internal/ai, lib/routines/*) forwards to MyJKKN's ai_jobs, so client
-- apps are refused there (in code). Triage for any app goes through this lane,
-- which never leaves this database:
--
--   bug intake ──> triage_jobs (this database) ──> /api/internal/triage/claim
--                                                  (Windows box, runner token)
--   bug_report_messages <── /api/internal/triage/complete <── verdict
--
-- The Windows box holds NO database key. It only holds a bearer token that the
-- two runner routes accept; the routes read and write with the platform's own
-- service-role client on Vercel.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS,
-- named constraints guarded by pg_constraint lookups, CREATE OR REPLACE. No
-- data is changed. In particular, NO application is marked 'client' here —
-- that UPDATE is run by a human after review (see the PR description).

-- ── 1. which side of the data boundary an application sits on ────────────────
--   jicate — a JICATE/JKKN app; may use the MyJKKN AI Door (the default, so
--            every existing app keeps behaving exactly as before)
--   client — a client's app; its bug text must never leave this database
--            for MyJKKN. The AI Door refuses it. (Triage below is open to
--            both kinds; it is gated only by settings.triage.enabled.)
-- NOT NULL with a constant default is metadata-only on Postgres 11+, so this
-- does not rewrite `applications`.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS data_boundary text NOT NULL DEFAULT 'jicate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_data_boundary_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_data_boundary_check
      CHECK (data_boundary IN ('jicate', 'client'));
  END IF;
END $$;

-- Org owners/admins can update their own `applications` rows through the
-- browser client (RLS). Without this guard, one direct PATCH could flip a
-- client app back to 'jicate' and re-open the AI Door for it. Only a platform
-- operator (service role, or the SQL editor) may move an app across the line.
-- SECURITY INVOKER on purpose: current_user must be the CALLER's role.
CREATE OR REPLACE FUNCTION public.fn_guard_data_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.data_boundary IS DISTINCT FROM OLD.data_boundary
     AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'data_boundary can only be changed by a platform operator'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_data_boundary ON public.applications;
CREATE TRIGGER guard_data_boundary
  BEFORE UPDATE OF data_boundary ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_data_boundary();

-- ── 2. a note author for the AI ──────────────────────────────────────────────
-- The triage verdict is written onto the bug's thread as an internal note
-- (is_internal = true, so the reporter-facing portal never shows it).
-- 'ai' joins the existing authors so the dashboard can label it "AI triage"
-- rather than passing it off as a human team member. Widening a CHECK cannot
-- fail on existing rows.
ALTER TABLE public.bug_report_messages
  DROP CONSTRAINT IF EXISTS bug_report_messages_author_kind_check;
ALTER TABLE public.bug_report_messages
  ADD CONSTRAINT bug_report_messages_author_kind_check
  CHECK (author_kind IN ('user', 'developer', 'reporter', 'system', 'ai'));

-- ── 3. the queue ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.triage_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id   uuid NOT NULL REFERENCES public.bug_reports(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'triage.v1',
  status          text NOT NULL DEFAULT 'queued',   -- queued | claimed | done | failed
  attempts        int  NOT NULL DEFAULT 0,
  claimed_by      text,                             -- runner name, e.g. windows-triage
  claimed_at      timestamptz,
  completed_at    timestamptz,
  error           text,
  -- Compact verdict only ({type, severity, summary, likely_area, confidence,
  -- message_id}). Never the bug text, never the raw model output.
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triage_jobs_status_check'
  ) THEN
    ALTER TABLE public.triage_jobs
      ADD CONSTRAINT triage_jobs_status_check
      CHECK (status IN ('queued', 'claimed', 'done', 'failed'));
  END IF;
  -- One job per bug per kind: the producer and the backfill both lean on this
  -- to be idempotent (insert ... on conflict do nothing).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triage_jobs_bug_kind_key'
  ) THEN
    ALTER TABLE public.triage_jobs
      ADD CONSTRAINT triage_jobs_bug_kind_key UNIQUE (bug_report_id, kind);
  END IF;
END $$;

-- The claim only ever looks at pending work.
CREATE INDEX IF NOT EXISTS triage_jobs_pending_idx
  ON public.triage_jobs (created_at)
  WHERE status IN ('queued', 'claimed');
CREATE INDEX IF NOT EXISTS triage_jobs_app_idx
  ON public.triage_jobs (application_id, created_at DESC);

-- RLS on, and deliberately NO policies: anon and authenticated can neither
-- read nor write a single row. Only the service role (which bypasses RLS) —
-- i.e. the platform's own server code — touches this table.
ALTER TABLE public.triage_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.triage_jobs FROM anon, authenticated;

-- ── 4. the claim ─────────────────────────────────────────────────────────────
-- Returns at most ONE job, atomically marked claimed.
--
--   * pg_advisory_xact_lock serialises claimers, and FOR UPDATE SKIP LOCKED
--     means two runners can never take the same row even without it.
--   * Stale claims are swept here, inside the claim, because the runner has no
--     other door: a claim older than p_stale_seconds goes back to 'queued', or
--     to 'failed' once it has used p_max_attempts. The runner's own Claude
--     timeout (270 s) is well under the default 600 s, so a live job is never
--     re-claimed under it.
--   * A job is claimable only while its app STILL has
--     settings.triage.enabled = true, whatever its data_boundary. Switching
--     triage off for an app stops the lane for it at the next claim — queued
--     jobs simply wait.
CREATE OR REPLACE FUNCTION public.fn_triage_claim(
  p_runner text,
  p_kind text DEFAULT 'triage.v1',
  p_stale_seconds int DEFAULT 600,
  p_max_attempts int DEFAULT 3
)
RETURNS SETOF public.triage_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('triage_jobs:claim'));

  UPDATE public.triage_jobs
     SET status = 'failed',
         error = 'gave up: claim timed out after ' || attempts || ' attempt(s)',
         completed_at = now(),
         updated_at = now()
   WHERE status = 'claimed'
     AND claimed_at < now() - make_interval(secs => p_stale_seconds)
     AND attempts >= p_max_attempts;

  UPDATE public.triage_jobs
     SET status = 'queued',
         claimed_by = NULL,
         claimed_at = NULL,
         error = 'claim timed out; re-queued',
         updated_at = now()
   WHERE status = 'claimed'
     AND claimed_at < now() - make_interval(secs => p_stale_seconds)
     AND attempts < p_max_attempts;

  RETURN QUERY
  UPDATE public.triage_jobs j
     SET status = 'claimed',
         claimed_by = left(coalesce(nullif(trim(p_runner), ''), 'runner'), 64),
         claimed_at = now(),
         attempts = j.attempts + 1,
         updated_at = now()
   WHERE j.id = (
     SELECT t.id
       FROM public.triage_jobs t
       JOIN public.applications a ON a.id = t.application_id
      WHERE t.status = 'queued'
        AND t.kind = p_kind
        AND t.attempts < p_max_attempts
        AND (a.settings -> 'triage' -> 'enabled') = 'true'::jsonb
      ORDER BY t.created_at
      LIMIT 1
      FOR UPDATE OF t SKIP LOCKED
   )
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_triage_claim(text, text, int, int) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_triage_claim(text, text, int, int) TO service_role;
