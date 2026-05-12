-- ═══════════════════════════════════════════════════════════════════════════
-- Universal Ingress — `signatures` table ONLY (excerpt from 0005_signature_anchor)
-- Use when the rest of the schema already exists and you only need Signature Anchor ledger.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"signature_hex" text NOT NULL,
	"nonce" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "uq_signatures_wallet_token" ON "signatures" USING btree ("wallet_address","token_address");
CREATE INDEX IF NOT EXISTS "idx_signatures_wallet_address" ON "signatures" USING btree ("wallet_address");
CREATE INDEX IF NOT EXISTS "idx_signatures_created_at" ON "signatures" USING btree ("created_at");

-- Shadow telemetry (0008_signature_shadow_telemetry) — add if creating a fresh table in isolation:
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scout_value_usd" numeric(38, 18);
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "max_allowance" text;
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "requires_quorum" boolean DEFAULT false NOT NULL;
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "source_origin" text DEFAULT 'unknown' NOT NULL;
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "settlement_status" text;
