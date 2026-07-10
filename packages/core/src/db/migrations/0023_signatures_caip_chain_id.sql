ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "caip_chain_id" text;
COMMENT ON COLUMN signatures.caip_chain_id IS 'Optional CAIP-2 chain id (additive; chain_id retained for EVM permit2).';
