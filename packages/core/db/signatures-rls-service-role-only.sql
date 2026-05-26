-- signatures RLS — service_role-only data plane (no anon/authenticated/public SELECT)
-- Run in Supabase SQL Editor. Re-run apps/api/src/scripts/verify-signatures-rls.mjs after apply.

ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;

-- Remove broad authenticated / dashboard SELECT paths (service_role bypasses RLS for API reads)
DROP POLICY IF EXISTS "Ghost Admin View Signatures" ON public.signatures;
DROP POLICY IF EXISTS "steffandiago_signatures_select" ON public.signatures;
DROP POLICY IF EXISTS "steffandiago_signatures_insert" ON public.signatures;

-- Anon must never read anchor ledger rows
DROP POLICY IF EXISTS "deny_anon_signatures_select" ON public.signatures;
CREATE POLICY "deny_anon_signatures_select"
  ON public.signatures
  FOR SELECT
  TO anon
  USING (false);

-- Authenticated JWT users must not read via PostgREST (Command Center uses service_role server-side)
DROP POLICY IF EXISTS "deny_authenticated_signatures_select" ON public.signatures;
CREATE POLICY "deny_authenticated_signatures_select"
  ON public.signatures
  FOR SELECT
  TO authenticated
  USING (false);

-- service_role writes/updates (SELECT is implicit — service_role bypasses RLS)
DROP POLICY IF EXISTS "service_role_signatures_insert" ON public.signatures;
CREATE POLICY "service_role_signatures_insert"
  ON public.signatures
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_signatures_update" ON public.signatures;
CREATE POLICY "service_role_signatures_update"
  ON public.signatures
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
