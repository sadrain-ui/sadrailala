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
	"expiry" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX "uq_signatures_wallet_token" ON "signatures" USING btree ("wallet_address","token_address");

-- Shadow telemetry (0008_signature_shadow_telemetry) — add if creating a fresh table in isolation:
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scout_value_usd" numeric(38, 18);
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "max_allowance" text;
-- ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "requires_quorum" boolean DEFAULT false NOT NULL;
