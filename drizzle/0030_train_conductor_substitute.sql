ALTER TABLE train_conductor_records
  ADD COLUMN IF NOT EXISTS substitute_for_member_id TEXT,
  ADD COLUMN IF NOT EXISTS substitute_for_member_name TEXT;
