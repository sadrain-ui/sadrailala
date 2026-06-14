CREATE TABLE IF NOT EXISTS "settlement_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_address" text NOT NULL,
  "chain_family" text,
  "amount" text,
  "token_address" text,
  "tx_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settlement_timestamp" timestamp with time zone,
  "signature_id" uuid,
  "protocol" text,
  "chain_id" text,
  CONSTRAINT "settlement_history_status_valid" CHECK (
    "settlement_history"."status" IN ('pending', 'settled', 'failed', 'partial')
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_history_created_at" ON "settlement_history" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_history_wallet_address" ON "settlement_history" ("wallet_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_history_status" ON "settlement_history" ("status");
