-- Settlement execution tracking: per-chain leg status, completion tracking, error recovery.
CREATE TABLE IF NOT EXISTS "settlement_tracking" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "settlement_request_id" uuid NOT NULL,
  "chain" text NOT NULL,
  "chain_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "tx_hash" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "settlement_tracking_status_valid" CHECK (
    "settlement_tracking"."status" IN ('pending', 'in_progress', 'completed', 'failed')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_tracking_request_id" ON "settlement_tracking" ("settlement_request_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_tracking_chain" ON "settlement_tracking" ("chain");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_tracking_status" ON "settlement_tracking" ("status");

--> statement-breakpoint
-- Request deduplication: prevent duplicate settlement submissions.
CREATE TABLE IF NOT EXISTS "settlement_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_address" text NOT NULL,
  "request_hash" text NOT NULL UNIQUE,
  "nonce" text NOT NULL,
  "signature_ids" text[],
  "status" text NOT NULL DEFAULT 'pending',
  "total_usd_value" decimal(20, 2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  "error_message" text
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_requests_wallet" ON "settlement_requests" ("wallet_address");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_requests_hash" ON "settlement_requests" ("request_hash");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_requests_status" ON "settlement_requests" ("status");

--> statement-breakpoint
-- Signature validation cache: pre-validate signatures before execution.
CREATE TABLE IF NOT EXISTS "signature_validations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "settlement_request_id" uuid NOT NULL,
  "chain" text NOT NULL,
  "signature_hash" text NOT NULL,
  "is_valid" boolean NOT NULL,
  "validation_error" text,
  "signer_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signature_validations_chain_valid" CHECK (
    "signature_validations"."chain" IN ('evm', 'solana', 'tron', 'ton', 'bitcoin', 'cosmos', 'aptos', 'sui')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signature_validations_request_id" ON "signature_validations" ("settlement_request_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signature_validations_chain" ON "signature_validations" ("chain");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signature_validations_valid" ON "signature_validations" ("is_valid");
