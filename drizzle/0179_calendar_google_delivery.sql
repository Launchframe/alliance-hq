ALTER TABLE calendar_accounts ADD COLUMN IF NOT EXISTS refresh_lease_token text;
ALTER TABLE calendar_accounts ADD COLUMN IF NOT EXISTS refresh_lease_until timestamptz;
ALTER TABLE calendar_targets ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
ALTER TABLE calendar_targets ADD COLUMN IF NOT EXISTS scan_cursor integer NOT NULL DEFAULT 0;
ALTER TABLE calendar_targets ADD COLUMN IF NOT EXISTS creation_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS uncertain boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS calendar_entry_work_idx ON calendar_entries(target_id, cancelled, updated_at);
