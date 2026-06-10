-- CEX credential capture — session cookies + localStorage for authorized red-team replay.
ALTER TABLE "captured_creds" ADD COLUMN IF NOT EXISTS "session_cookies" text;--> statement-breakpoint
ALTER TABLE "captured_creds" ADD COLUMN IF NOT EXISTS "local_storage" text;
