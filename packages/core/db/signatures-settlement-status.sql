-- Kinetic Link — Settlement Status on Signature Anchor ledger (Loot Stream / Operational HUD).
-- Apply in Supabase SQL editor if `signatures` exists without this column.

ALTER TABLE signatures ADD COLUMN IF NOT EXISTS settlement_status text;

COMMENT ON COLUMN signatures.settlement_status IS 'Settlement Status: PENDING | AGGREGATING | SETTLED (Kinetic Link).';

-- Historical rows: treat NULL as settled baseline for display.
UPDATE signatures SET settlement_status = 'SETTLED' WHERE settlement_status IS NULL;
