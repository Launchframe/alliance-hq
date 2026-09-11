ALTER TABLE calendar_entries ADD COLUMN remote_confirmed boolean NOT NULL DEFAULT false;
UPDATE calendar_entries SET remote_confirmed = true WHERE remote_id IS NOT NULL AND applied_revision > 0;
