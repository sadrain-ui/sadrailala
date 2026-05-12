-- Admin retrieval posture — timestamped Signature Anchor and durable telemetry indexes.
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signatures_wallet_address" ON "signatures" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_signatures_created_at" ON "signatures" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text,
	"event_type" text DEFAULT 'system' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_wallet_address" ON "telemetry" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_created_at" ON "telemetry" USING btree ("created_at");
