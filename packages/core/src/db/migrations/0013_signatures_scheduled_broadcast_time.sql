ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "scheduled_broadcast_time" timestamp with time zone;
