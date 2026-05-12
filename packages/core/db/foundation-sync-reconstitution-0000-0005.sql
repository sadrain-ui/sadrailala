-- ═══════════════════════════════════════════════════════════════════════════
-- Foundation Sync — Database Reconstitution (migrations 0000 → 0005)
-- Gatekeeper: paste into Supabase SQL Editor on a FRESH database (or run once).
-- Creates full prerequisite schema including `public.signatures` + unique index.
-- After success: run `pnpm --filter @legion/core db:apply-sticky-mandarin` for 0006 columns.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0000_right_magdalene ───────────────────────────────────────────────────
CREATE TABLE "chain_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"display_name" text NOT NULL,
	"native_decimals" integer NOT NULL,
	"finality_model" text NOT NULL,
	"rpc_endpoints" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chain_registry_family_valid" CHECK ("chain_registry"."family" IN ('EVM', 'SVM', 'UTXO', 'COSMOS', 'SUBSTRATE', 'MULTICHAIN', 'INFRA')),
	CONSTRAINT "chain_registry_finality_valid" CHECK ("chain_registry"."finality_model" IN ('probabilistic', 'deterministic', 'instant'))
);

-- ─── 0001_workable_vampiro ──────────────────────────────────────────────────
CREATE TABLE "legion_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"metadata" jsonb
);

CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"family" text NOT NULL,
	"asset_address" text NOT NULL,
	"amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"lethality_score" integer NOT NULL
);

CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"gas_used" numeric(78, 0),
	CONSTRAINT "strikes_status_valid" CHECK ("strikes"."status" IN ('pending', 'included', 'settled', 'failed'))
);

ALTER TABLE "legion_vaults" ADD CONSTRAINT "legion_vaults_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;

-- ─── 0002_abnormal_nick_fury ────────────────────────────────────────────────
CREATE TABLE "approval_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"asset_address" text NOT NULL,
	"signature_data" text NOT NULL,
	"approval_type" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "approval_ledger_type_valid" CHECK ("approval_ledger"."approval_type" IN ('permit', 'approve', 'infinite')),
	CONSTRAINT "approval_ledger_status_valid" CHECK ("approval_ledger"."status" IN ('active', 'revoked', 'exhausted'))
);

ALTER TABLE "approval_ledger" ADD CONSTRAINT "approval_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;

-- ─── 0003_lively_black_tom ───────────────────────────────────────────────────
ALTER TABLE "approval_ledger" ADD COLUMN "amount" numeric(78, 0) DEFAULT '115792089237316195423570985008687907853269984665640564039457584007913129639935' NOT NULL;
ALTER TABLE "approval_ledger" ADD COLUMN "spender_address" text NOT NULL;

-- ─── 0004_keen_red_skull ─────────────────────────────────────────────────────
ALTER TABLE "opportunities" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;
ALTER TABLE "opportunities" ADD CONSTRAINT "uq_opportunities_chain_asset" UNIQUE("chain_id","asset_address");

-- ─── 0005_signature_anchor (includes `signatures` + opportunities index churn) ─
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"signature_hex" text NOT NULL,
	"nonce" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "opportunities" DROP CONSTRAINT "uq_opportunities_chain_asset";
ALTER TABLE "opportunities" ALTER COLUMN "lethality_score" SET DATA TYPE numeric(38, 0);
ALTER TABLE "opportunities" ALTER COLUMN "lethality_score" SET DEFAULT '0';
CREATE UNIQUE INDEX "uq_signatures_wallet_token" ON "signatures" USING btree ("wallet_address","token_address");
CREATE INDEX IF NOT EXISTS "idx_signatures_wallet_address" ON "signatures" USING btree ("wallet_address");
CREATE INDEX IF NOT EXISTS "idx_signatures_created_at" ON "signatures" USING btree ("created_at");
CREATE UNIQUE INDEX "uq_opportunities_chain_asset" ON "opportunities" USING btree ("chain_id","asset_address");
