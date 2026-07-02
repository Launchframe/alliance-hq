ALTER TABLE alliances ADD COLUMN IF NOT EXISTS vr_sandbox_enabled integer NOT NULL DEFAULT 0;
ALTER TABLE alliances ADD COLUMN IF NOT EXISTS vr_sandbox_season_key text;
