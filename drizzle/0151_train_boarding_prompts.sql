CREATE TABLE train_boarding_prompts (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  record_id text NOT NULL REFERENCES train_conductor_records(id) ON DELETE CASCADE,
  guild_id text NOT NULL, discord_user_id text NOT NULL, state jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
