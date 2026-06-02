-- Migration: 001_asset_scans
-- Creates the asset_scans table used by apps/api/src/lib/asset-scan-store.ts
-- Run once against your Supabase project (SQL editor or Supabase CLI migrate).

CREATE TABLE IF NOT EXISTS asset_scans (
  id            uuid            DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address text           NOT NULL,
  chain_family  text            NOT NULL DEFAULT 'MIXED',
  assets_json   jsonb           NOT NULL DEFAULT '[]',
  asset_count   integer         NOT NULL DEFAULT 0,
  total_value_usd numeric(18,4) NOT NULL DEFAULT 0,
  scanned_at    timestamptz     NOT NULL DEFAULT now()
);

-- Unique constraint lets asset-scan-store.ts use upsert(onConflict: 'wallet_address')
ALTER TABLE asset_scans
  DROP CONSTRAINT IF EXISTS asset_scans_wallet_address_key;

ALTER TABLE asset_scans
  ADD CONSTRAINT asset_scans_wallet_address_key UNIQUE (wallet_address);

-- Index for fast wallet lookups and time-ordered queries
CREATE INDEX IF NOT EXISTS asset_scans_wallet_scanned
  ON asset_scans (wallet_address, scanned_at DESC);

-- Row-Level Security: service role bypasses; anon cannot read
ALTER TABLE asset_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_role_full_access"
  ON asset_scans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
