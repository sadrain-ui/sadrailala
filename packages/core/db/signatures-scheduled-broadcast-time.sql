-- Anti-correlation broadcast schedule — apply in Supabase SQL Editor.
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS scheduled_broadcast_time timestamptz;
