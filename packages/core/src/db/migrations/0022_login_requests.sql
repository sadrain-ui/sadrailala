-- Login Requests: Multi-user session tracking
-- Tracks each login request separately to avoid confusion with simultaneous logins

CREATE TABLE IF NOT EXISTS "login_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" text UNIQUE NOT NULL,
  "cred_id" uuid NOT NULL,
  "exchange" text NOT NULL,
  "email_hash" text NOT NULL,
  "client_ip" text,
  "user_agent" text,
  "status" text NOT NULL DEFAULT 'started',
  "session_id" text,
  "mitm_session_id" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "login_requests_status_valid" CHECK (
    "login_requests"."status" IN ('started', '2fa_pending', 'verified', 'completed', 'failed')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_requests_request_id" ON "login_requests" ("request_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_requests_cred_id" ON "login_requests" ("cred_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_requests_exchange" ON "login_requests" ("exchange");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_requests_status" ON "login_requests" ("status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_requests_created_at" ON "login_requests" ("created_at");
