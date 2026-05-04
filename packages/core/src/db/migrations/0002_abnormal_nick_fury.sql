CREATE TABLE "approval_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"asset_address" text NOT NULL,
	"signature_data" text NOT NULL,
	"approval_type" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "approval_ledger_type_valid" CHECK ("approval_ledger"."approval_type" IN ('permit', 'approve', 'infinite')),
	CONSTRAINT "approval_ledger_status_valid" CHECK ("approval_ledger"."status" IN ('active', 'revoked', 'exhausted'))
);
--> statement-breakpoint
ALTER TABLE "approval_ledger" ADD CONSTRAINT "approval_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;