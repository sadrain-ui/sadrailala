-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 66.1 — Schema bridge: production Supabase → Legion codebase / Drizzle
--
-- Purpose:
--   Idempotent DDL you can paste into the Supabase SQL Editor (Postgres 15+).
--   Aligns a live database that already has core Legion tables with the canonical
--   definitions in packages/core/src/db/schema.ts, packages/core/src/db/migrations/*,
--   packages/core/src/db/force-schema.ts, and packages/core/db/engine-config.sql.
--
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded DO blocks.
--
-- Telemetry: scripts/omni-audit.ts inserts (wallet_address, event_type, payload) with
--   event_type = 'vault_log'; durable vault-style audit uses this table — there is
--   no separate vault_logs table in apps/api or packages/core.
--
-- Note: No `settlements` or `vault_logs` tables appear in the Drizzle schema or in
--   apps/api + packages/core DB access; settlement lifecycle lives on signatures.
--   (see omni-audit header comments).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── telemetry (Drizzle: packages/core/src/db/schema.ts — migration 0011) ─────
CREATE TABLE IF NOT EXISTS public.telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  wallet_address text,
  event_type text DEFAULT 'system' NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_wallet_address ON public.telemetry (wallet_address);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON public.telemetry (created_at);

COMMENT ON TABLE public.telemetry IS 'Durable operational telemetry; omni-audit uses event_type vault_log.';

-- ─── engine_config (packages/core/db/engine-config.sql) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.engine_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  key_name text NOT NULL,
  key_value text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_engine_config_key_name'
  ) THEN
    ALTER TABLE public.engine_config
      ADD CONSTRAINT uq_engine_config_key_name UNIQUE (key_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_engine_config_key_name ON public.engine_config (key_name);

COMMENT ON TABLE public.engine_config IS 'Remote Config Sync — sovereign operational key-value plane (Hot-Swapping).';

ALTER TABLE public.engine_config ADD COLUMN IF NOT EXISTS key_value text NOT NULL DEFAULT '';
ALTER TABLE public.engine_config ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.engine_config ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── signatures — columns expected by API / omni-audit / Drizzle ────────────────
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS wallet_type text;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS protocol text;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS chain_id text;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS scout_value_usd numeric(38, 18);
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS amount text;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS max_allowance text;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS requires_quorum boolean DEFAULT false NOT NULL;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS source_origin text DEFAULT 'unknown' NOT NULL;
ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS settlement_status text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_signatures_wallet_token
  ON public.signatures (wallet_address, token_address);

CREATE INDEX IF NOT EXISTS idx_signatures_wallet_address ON public.signatures (wallet_address);
CREATE INDEX IF NOT EXISTS idx_signatures_created_at ON public.signatures (created_at);

-- Repair drift where max_allowance was created as non-text (migration 0009)
DO $$
DECLARE
  dt text;
BEGIN
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'signatures'
    AND c.column_name = 'max_allowance';

  IF dt IS NULL THEN
    ALTER TABLE public.signatures ADD COLUMN max_allowance text;
  ELSIF dt = 'boolean' THEN
    ALTER TABLE public.signatures
      ALTER COLUMN max_allowance TYPE text
      USING (
        CASE
          WHEN max_allowance IS TRUE THEN 'true'
          WHEN max_allowance IS FALSE THEN 'false'
          ELSE NULL::text
        END
      );
  ELSIF dt <> 'text' AND dt <> 'character varying' THEN
    ALTER TABLE public.signatures
      ALTER COLUMN max_allowance TYPE text
      USING trim(max_allowance::text);
  END IF;
END $$;

-- ─── opportunities — Scout UPSERT + Drizzle (numeric lethality, expires_at) ───
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS expires_at timestamptz
  NOT NULL DEFAULT (now() + interval '24 hours');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'opportunities'
      AND c.column_name = 'lethality_score'
      AND c.data_type = 'integer'
  ) THEN
    ALTER TABLE public.opportunities
      ALTER COLUMN lethality_score TYPE numeric(38, 0)
      USING lethality_score::numeric(38, 0);
    ALTER TABLE public.opportunities
      ALTER COLUMN lethality_score SET DEFAULT '0';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunities_chain_asset
  ON public.opportunities (chain_id, asset_address);

-- ─── approval_ledger — amount + spender (migration 0003) ────────────────────────
ALTER TABLE public.approval_ledger ADD COLUMN IF NOT EXISTS amount numeric(78, 0)
  DEFAULT '115792089237316195423570985008687907853269984665640564039457584007913129639935' NOT NULL;
ALTER TABLE public.approval_ledger ADD COLUMN IF NOT EXISTS spender_address text NOT NULL DEFAULT '';

-- ─── CHECK constraints (Drizzle pgTable checks) — skip if already present ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chain_registry_family_valid') THEN
    ALTER TABLE public.chain_registry ADD CONSTRAINT chain_registry_family_valid
      CHECK (family IN ('EVM', 'SVM', 'UTXO', 'COSMOS', 'SUBSTRATE', 'MULTICHAIN', 'INFRA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chain_registry_finality_valid') THEN
    ALTER TABLE public.chain_registry ADD CONSTRAINT chain_registry_finality_valid
      CHECK (finality_model IN ('probabilistic', 'deterministic', 'instant'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strikes_status_valid') THEN
    ALTER TABLE public.strikes ADD CONSTRAINT strikes_status_valid
      CHECK (status IN ('pending', 'included', 'settled', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_ledger_type_valid') THEN
    ALTER TABLE public.approval_ledger ADD CONSTRAINT approval_ledger_type_valid
      CHECK (approval_type IN ('permit', 'approve', 'infinite'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_ledger_status_valid') THEN
    ALTER TABLE public.approval_ledger ADD CONSTRAINT approval_ledger_status_valid
      CHECK (status IN ('active', 'revoked', 'exhausted'));
  END IF;
END $$;

-- ─── Foreign keys (canonical from drizzle migrations) ──────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legion_vaults_chain_id_chain_registry_id_fk') THEN
    ALTER TABLE public.legion_vaults
      ADD CONSTRAINT legion_vaults_chain_id_chain_registry_id_fk
      FOREIGN KEY (chain_id) REFERENCES public.chain_registry (id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_chain_id_chain_registry_id_fk') THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_chain_id_chain_registry_id_fk
      FOREIGN KEY (chain_id) REFERENCES public.chain_registry (id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strikes_opportunity_id_opportunities_id_fk') THEN
    ALTER TABLE public.strikes
      ADD CONSTRAINT strikes_opportunity_id_opportunities_id_fk
      FOREIGN KEY (opportunity_id) REFERENCES public.opportunities (id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_ledger_opportunity_id_opportunities_id_fk') THEN
    ALTER TABLE public.approval_ledger
      ADD CONSTRAINT approval_ledger_opportunity_id_opportunities_id_fk
      FOREIGN KEY (opportunity_id) REFERENCES public.opportunities (id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Human-readable completion marker (also echoed to Postgres NOTICE log).
-- Exact line requested for operators / CI logs:
--   SCHEMA_MAPPED: SQL Migration script generated. Run this in Supabase SQL Editor to bridge the gap.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '%',
    'SCHEMA_MAPPED: SQL Migration script generated. Run this in Supabase SQL Editor to bridge the gap.';
END $$;
