-- Migration: Reporter Loop Control Tower — loop_registry
-- Date: 2026-07-20
-- Purpose: A visible registry of the reporter's loops + cadence routines,
--   mirroring MyJKKN's loop_registry so the Apps Control Tower has parity.
--   Read-only display data. Gates are flipped by LATER migrations as each loop
--   EARNS its gate (propose earns nothing; m = measurement; f = feed-forward) —
--   exactly like MyJKKN, where gate flips are hand-written migrations, never
--   automatic. Seeded at each loop's HONEST current maturity, nothing overclaimed.
--
-- Gate meanings (mirrors MyJKKN):
--   a = loop is active/live · g = ground-truth source wired ·
--   m = human measurement being recorded · f = feed-forward learning from measured.

CREATE TABLE IF NOT EXISTS public.loop_registry (
  loop_key       text PRIMARY KEY,
  name           text NOT NULL,
  stack_tier     integer NOT NULL DEFAULT 3,
  loop_class     text NOT NULL DEFAULT 'cadence'
                   CHECK (loop_class IN ('cadence','intake','accountability','infrastructure','self_improving')),
  domain         text,
  description    text,
  gates          jsonb NOT NULL DEFAULT '{"a":"off","g":"off","m":"off","f":"off"}'::jsonb,
  routine_id     text,
  owner_email    text,
  counter_metric text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS: platform-level loops are readable by any signed-in reporter user; writes
-- are service-role only (gate flips ship as migrations, like MyJKKN). anon gets
-- nothing — no policy grants it, and the direct grant is revoked below.
ALTER TABLE public.loop_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loop_registry_authenticated_read" ON public.loop_registry;
CREATE POLICY "loop_registry_authenticated_read"
  ON public.loop_registry FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.loop_registry FROM anon;

-- Seed the reporter's current loops at their HONEST maturity.
INSERT INTO public.loop_registry
  (loop_key, name, stack_tier, loop_class, domain, description, gates, routine_id, owner_email, counter_metric)
VALUES
  ('app.brief',
   'Scheduled Briefing',
   3, 'cadence', 'platform',
   'A per-app plain-English bug briefing that runs on a schedule on the ₹0 Max lane. A cadence routine — it reports, it does not self-improve (there is no human ground truth for it to learn from).',
   '{"a":"on","g":"off","m":"off","f":"off"}'::jsonb,
   'app.brief', 'aieee@jkkn.ac.in', NULL),
  ('app.dupe-scan',
   'Duplicate-Bug Detection Loop',
   4, 'intake', 'platform',
   'Proposes likely-duplicate bug pairs by meaning (pgvector, ₹0); an admin confirms or dismisses (the ground truth); the next scan learns from those measured verdicts. Copies MyJKKN''s graduated bug-triage moat. Being built now: the propose layer is done (PR #14, pending merge); the measurement (m) and feed-forward (f) gates are next.',
   '{"a":"off","g":"off","m":"off","f":"off"}'::jsonb,
   NULL, 'aieee@jkkn.ac.in', NULL)
ON CONFLICT (loop_key) DO NOTHING;
