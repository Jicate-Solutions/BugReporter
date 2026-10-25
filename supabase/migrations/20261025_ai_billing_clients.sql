-- 20261025_ai_billing_clients.sql
-- Monthly AI bill per app: which client an app belongs to, and that client's
-- discount.
--
-- Why: the Director bills each app monthly at "Claude API price minus a
-- discount set per client" (decided 24 Oct 2026). Clients are kept in MyJKKN
-- (sh_clients, another database). The Control Tower must NOT become a second
-- client list, so this table holds only:
--
--   ai_billing_clients.myjkkn_client_id  the MyJKKN sh_clients.id (a reference;
--                                        no foreign key, it lives in MyJKKN)
--   ai_billing_clients.name_cached       the client's name as last copied from
--                                        MyJKKN, for display only
--   ai_billing_clients.discount_pct      0-100, the discount off the API price;
--                                        a new client starts at 0
--   applications.billing_client_id       which client an app is billed to; NULL
--                                        = "No client linked", billed at 0%
--
-- No contact, GST or address columns on purpose: those stay in MyJKKN.
--
-- RLS: org members read, org owners/admins (and super admins) write, the same
-- pair as 20260718_app_ai_routines.sql. The app's own server route also checks
-- owner/admin before linking an app (applications' own UPDATE policy lets an
-- app maintainer change any column, so it is not relied on here).
--
-- Additive only (one new table, one new nullable column). Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_billing_clients (
  myjkkn_client_id uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_cached      text NOT NULL CHECK (char_length(name_cached) BETWEEN 1 AND 200),
  discount_pct     numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_billing_clients_org_idx ON public.ai_billing_clients (organization_id);

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS billing_client_id uuid
    REFERENCES public.ai_billing_clients(myjkkn_client_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS applications_billing_client_idx ON public.applications (billing_client_id);

ALTER TABLE public.ai_billing_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_billing_clients_read ON public.ai_billing_clients;
CREATE POLICY ai_billing_clients_read ON public.ai_billing_clients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR organization_id IN (
      SELECT m.organization_id FROM public.organization_members m WHERE m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ai_billing_clients_write ON public.ai_billing_clients;
CREATE POLICY ai_billing_clients_write ON public.ai_billing_clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = ai_billing_clients.organization_id
        AND m.role = ANY (ARRAY['owner','admin'])
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = ai_billing_clients.organization_id
        AND m.role = ANY (ARRAY['owner','admin'])
    )
  );

COMMIT;
