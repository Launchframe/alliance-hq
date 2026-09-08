-- Custom SQL migration file, put your code below! --
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS global_absence boolean NOT NULL DEFAULT false;
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS request_key text;
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS member_time_off_request_key_unique ON member_time_off (request_key);

CREATE TABLE IF NOT EXISTS member_time_off_revisions (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES member_time_off(id) ON DELETE RESTRICT,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  recorded_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  recorded_by_discord_user_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_time_off_revisions_entry_version_unique UNIQUE (entry_id, version)
);
CREATE INDEX IF NOT EXISTS member_time_off_revisions_alliance_entry_idx ON member_time_off_revisions (alliance_id, entry_id);

CREATE TABLE IF NOT EXISTS time_off_discord_interactions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  discord_user_id text NOT NULL,
  state jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS time_off_discord_interactions_expires_idx ON time_off_discord_interactions (expires_at);
