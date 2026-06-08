-- Campaign mirror ops — URL, rotation interval, health check timestamp.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "mirror_url" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "mirror_subdomain" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "rotation_interval_hours" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "last_health_check_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaigns_mirror_url" ON "campaigns" USING btree ("mirror_url") WHERE mirror_url IS NOT NULL;
