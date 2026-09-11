ALTER TABLE calendar_accounts ADD COLUMN refresh_lease_token text;
ALTER TABLE calendar_accounts ADD COLUMN refresh_lease_until timestamptz;
ALTER TABLE calendar_targets ADD COLUMN generation integer NOT NULL DEFAULT 1;
ALTER TABLE calendar_targets ADD COLUMN scan_cursor integer NOT NULL DEFAULT 0;
ALTER TABLE calendar_targets ADD COLUMN creation_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE calendar_entries ADD COLUMN uncertain boolean NOT NULL DEFAULT false;
CREATE INDEX calendar_entry_work_idx ON calendar_entries(target_id, cancelled, updated_at);
