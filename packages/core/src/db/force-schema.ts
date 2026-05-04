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

import { Pool } from 'pg'
import { loadConfig } from '../config/loader.js'

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
    "lethality_score" integer NOT NULL
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
    "expiry" timestamp with time zone NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_signatures_wallet_token" ON "signatures" ("wallet_address", "token_address")`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "wallet_type" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "protocol" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "chain_id" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scout_value_usd" numeric(38, 18)`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "max_allowance" text`,
  `ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "requires_quorum" boolean DEFAULT false NOT NULL`,
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

  const pool = new Pool({ connectionString: cfg.database.url })
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
