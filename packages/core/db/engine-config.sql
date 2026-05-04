-- Remote Config Sync — Supabase Postgres DDL for `engine_config`
-- Run in SQL editor or via migration after Foundation Sync.
-- Hot-Swapping: operators upsert key_value rows; DynamicConfigResolver polls with 60s SWR.

CREATE TABLE IF NOT EXISTS engine_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name TEXT NOT NULL,
  key_value TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_engine_config_key_name UNIQUE (key_name)
);

CREATE INDEX IF NOT EXISTS idx_engine_config_key_name ON engine_config (key_name);

COMMENT ON TABLE engine_config IS 'Remote Config Sync — sovereign operational key-value plane (Hot-Swapping).';
