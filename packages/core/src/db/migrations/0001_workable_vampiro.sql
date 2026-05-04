CREATE TABLE "legion_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"address" text NOT NULL,
	"label" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"family" text NOT NULL,
	"asset_address" text NOT NULL,
	"amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"lethality_score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"gas_used" numeric(78, 0),
	CONSTRAINT "strikes_status_valid" CHECK ("strikes"."status" IN ('pending', 'included', 'settled', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "legion_vaults" ADD CONSTRAINT "legion_vaults_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_chain_id_chain_registry_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;