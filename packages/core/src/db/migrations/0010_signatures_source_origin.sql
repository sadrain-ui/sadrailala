-- Schema Sync — multi-tenant source_origin for Signature Anchor Data Binding (Gatekeeper).
ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "source_origin" text DEFAULT 'unknown' NOT NULL;
