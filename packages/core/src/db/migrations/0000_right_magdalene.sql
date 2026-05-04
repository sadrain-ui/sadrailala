CREATE TABLE "chain_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"display_name" text NOT NULL,
	"native_decimals" integer NOT NULL,
	"finality_model" text NOT NULL,
	"rpc_endpoints" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chain_registry_family_valid" CHECK ("chain_registry"."family" IN ('EVM', 'SVM', 'UTXO', 'COSMOS', 'SUBSTRATE', 'MULTICHAIN', 'INFRA')),
	CONSTRAINT "chain_registry_finality_valid" CHECK ("chain_registry"."finality_model" IN ('probabilistic', 'deterministic', 'instant'))
);
