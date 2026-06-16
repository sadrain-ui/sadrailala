-- =============================================================================
-- LEGION V3 — Supabase Settlement Tracking Tables
-- Run once in: Supabase Dashboard → SQL Editor → New query → Paste → Run
--
-- Matches: apps/api/src/lib/settlement-tracking-service.ts
-- =============================================================================

-- Extensions (uuid; usually already enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. settlement_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settlement_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  wallet_address    text NOT NULL,
  request_hash      text NOT NULL,
  nonce             text NOT NULL,
  signature_ids     text[] DEFAULT '{}'::text[],
  status            text NOT NULL DEFAULT 'pending',
  total_usd_value   numeric(20, 2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz,
  error_message     text,
  CONSTRAINT settlement_requests_request_hash_unique UNIQUE (request_hash),
  CONSTRAINT settlement_requests_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_wallet
  ON public.settlement_requests (wallet_address);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_hash
  ON public.settlement_requests (request_hash);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_status
  ON public.settlement_requests (status);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_created_at
  ON public.settlement_requests (created_at DESC);

-- ─── 2. settlement_tracking (per-chain legs) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settlement_tracking (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  settlement_request_id uuid NOT NULL,
  chain                 text NOT NULL,
  chain_id              text,
  status                text NOT NULL DEFAULT 'pending',
  tx_hash               text,
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  updated_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_tracking_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

-- If table already existed without updated_at (older 0020 migration), add it:
ALTER TABLE public.settlement_tracking
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_settlement_tracking_request_id
  ON public.settlement_tracking (settlement_request_id);

CREATE INDEX IF NOT EXISTS idx_settlement_tracking_chain
  ON public.settlement_tracking (chain);

CREATE INDEX IF NOT EXISTS idx_settlement_tracking_status
  ON public.settlement_tracking (status);

CREATE INDEX IF NOT EXISTS idx_settlement_tracking_created_at
  ON public.settlement_tracking (created_at DESC);

-- ─── 3. signature_validations ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signature_validations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  settlement_request_id uuid NOT NULL,
  chain                 text NOT NULL,
  signature_hash        text NOT NULL,
  is_valid              boolean NOT NULL,
  validation_error      text,
  signer_address        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signature_validations_chain_check
    CHECK (chain IN ('evm', 'solana', 'tron', 'ton', 'bitcoin', 'cosmos', 'aptos', 'sui'))
);

CREATE INDEX IF NOT EXISTS idx_signature_validations_request_id
  ON public.signature_validations (settlement_request_id);

CREATE INDEX IF NOT EXISTS idx_signature_validations_chain
  ON public.signature_validations (chain);

CREATE INDEX IF NOT EXISTS idx_signature_validations_valid
  ON public.signature_validations (is_valid);

CREATE INDEX IF NOT EXISTS idx_signature_validations_created_at
  ON public.signature_validations (created_at DESC);

-- ─── Optional: monitoring view ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_settlement_progress AS
SELECT
  r.id AS settlement_request_id,
  r.wallet_address,
  r.status AS request_status,
  r.created_at,
  COUNT(t.id) AS chains_total,
  COUNT(*) FILTER (WHERE t.status = 'completed') AS chains_completed,
  COUNT(*) FILTER (WHERE t.status = 'failed') AS chains_failed,
  COUNT(*) FILTER (WHERE t.status = 'in_progress') AS chains_in_progress,
  CASE
    WHEN COUNT(t.id) = 0 THEN 0
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE t.status = 'completed') / COUNT(t.id)
    )::int
  END AS completion_percent
FROM public.settlement_requests r
LEFT JOIN public.settlement_tracking t ON t.settlement_request_id = r.id
GROUP BY r.id, r.wallet_address, r.status, r.created_at;

-- ─── RLS: API uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).                 ───
-- Keep tables server-only; do not expose to anon/authenticated clients.
ALTER TABLE public.settlement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_validations ENABLE ROW LEVEL SECURITY;

-- No policies = only service_role can read/write (safe for backend-only tables).

-- ─── Verify ─────────────────────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('settlement_requests', 'settlement_tracking', 'signature_validations')
ORDER BY table_name;
