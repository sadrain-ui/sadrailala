-- Dashboard campaigns — harvest targeting lanes for ops dashboard.
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_domain" text NOT NULL,
	"destination_wallet" text NOT NULL,
	"chains" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_rotate" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaigns_active" ON "campaigns" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaigns_created_at" ON "campaigns" USING btree ("created_at");
