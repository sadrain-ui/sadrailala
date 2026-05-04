ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scout_value_usd" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "max_allowance" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "requires_quorum" boolean DEFAULT false NOT NULL;