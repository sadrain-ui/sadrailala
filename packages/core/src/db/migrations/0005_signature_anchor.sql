CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"signature_hex" text NOT NULL,
	"nonce" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "uq_opportunities_chain_asset";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "lethality_score" SET DATA TYPE numeric(38, 0);--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "lethality_score" SET DEFAULT '0';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_signatures_wallet_token" ON "signatures" USING btree ("wallet_address","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_opportunities_chain_asset" ON "opportunities" USING btree ("chain_id","asset_address");