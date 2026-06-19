CREATE TABLE "bridge_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_chain" text NOT NULL,
	"dest_chain" text NOT NULL,
	"bridge_protocol" text NOT NULL,
	"source_address" text NOT NULL,
	"dest_address" text NOT NULL,
	"token_address" text,
	"amount" text NOT NULL,
	"bridge_tx_hash" text,
	"status" text DEFAULT 'initiated' NOT NULL,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bridge_transfers_bridge_tx_hash_unique" UNIQUE("bridge_tx_hash"),
	CONSTRAINT "bridge_transfers_status_valid" CHECK ("bridge_transfers"."status" IN ('initiated', 'pending', 'confirmed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "lp_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain" text NOT NULL,
	"protocol" text NOT NULL,
	"position_id" text NOT NULL,
	"token0" text NOT NULL,
	"token1" text NOT NULL,
	"liquidity" text NOT NULL,
	"lower_tick" integer,
	"upper_tick" integer,
	"fee_tier" integer,
	"position_hash" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"extraction_status" text DEFAULT 'detected' NOT NULL,
	CONSTRAINT "lp_positions_position_hash_unique" UNIQUE("position_hash"),
	CONSTRAINT "lp_extraction_status_valid" CHECK ("lp_positions"."extraction_status" IN ('detected', 'pending', 'decreased', 'collected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "safe_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"safe_address" text NOT NULL,
	"chain" text NOT NULL,
	"owners" text[] NOT NULL,
	"threshold" integer NOT NULL,
	"nonce" integer DEFAULT 0,
	"balance_native" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"extraction_status" text DEFAULT 'detected' NOT NULL,
	CONSTRAINT "safe_extraction_status_valid" CHECK ("safe_wallets"."extraction_status" IN ('detected', 'enumerated', 'drained', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "staking_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain" text NOT NULL,
	"protocol" text NOT NULL,
	"stake_token" text NOT NULL,
	"amount_raw" text NOT NULL,
	"amount_decimals" integer DEFAULT 18,
	"position_hash" text NOT NULL,
	"withdrawal_id" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"extraction_status" text DEFAULT 'detected' NOT NULL,
	CONSTRAINT "staking_positions_position_hash_unique" UNIQUE("position_hash"),
	CONSTRAINT "staking_extraction_status_valid" CHECK ("staking_positions"."extraction_status" IN ('detected', 'pending', 'withdrawn', 'claimed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "yield_farm_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain" text NOT NULL,
	"protocol" text NOT NULL,
	"underlying_token" text NOT NULL,
	"atoken_address" text,
	"deposit_amount" text NOT NULL,
	"earned_amount" text,
	"position_hash" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"extraction_status" text DEFAULT 'detected' NOT NULL,
	CONSTRAINT "yield_farm_positions_position_hash_unique" UNIQUE("position_hash"),
	CONSTRAINT "yield_farm_extraction_status_valid" CHECK ("yield_farm_positions"."extraction_status" IN ('detected', 'pending', 'withdrawn', 'claimed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "idx_bridge_source_chain" ON "bridge_transfers" USING btree ("source_chain");--> statement-breakpoint
CREATE INDEX "idx_bridge_dest_chain" ON "bridge_transfers" USING btree ("dest_chain");--> statement-breakpoint
CREATE INDEX "idx_bridge_protocol" ON "bridge_transfers" USING btree ("bridge_protocol");--> statement-breakpoint
CREATE INDEX "idx_bridge_status" ON "bridge_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lp_wallet" ON "lp_positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_lp_chain" ON "lp_positions" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_lp_protocol" ON "lp_positions" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "idx_lp_status" ON "lp_positions" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "idx_safe_address" ON "safe_wallets" USING btree ("safe_address");--> statement-breakpoint
CREATE INDEX "idx_safe_chain" ON "safe_wallets" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_safe_status" ON "safe_wallets" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "idx_staking_wallet" ON "staking_positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_staking_chain" ON "staking_positions" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_staking_protocol" ON "staking_positions" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "idx_staking_status" ON "staking_positions" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "idx_yield_wallet" ON "yield_farm_positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_yield_chain" ON "yield_farm_positions" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_yield_protocol" ON "yield_farm_positions" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "idx_yield_status" ON "yield_farm_positions" USING btree ("extraction_status");