CREATE TABLE IF NOT EXISTS team_work_items (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_version text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('time_off', 'coverage', 'vs')),
  member_id text NOT NULL,
  stint text NOT NULL,
  team_id text,
  assignee_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  required_permission text NOT NULL,
  detail jsonb NOT NULL,
  href text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_work_source_unique UNIQUE (alliance_id, source_key)
);
CREATE INDEX IF NOT EXISTS team_work_assignee_idx ON team_work_items(alliance_id, assignee_id, open);
CREATE TABLE IF NOT EXISTS team_work_digests (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES hq_users(id) ON DELETE CASCADE,
  day text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'posting', 'uncertain', 'sent', 'cancelled')),
  lease_token text,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  discord_user_id text,
  channel_id text,
  message_id text,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_work_digest_day_unique UNIQUE (alliance_id, recipient_id, day)
);
CREATE INDEX IF NOT EXISTS team_work_delivery_due_idx ON team_work_digests(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS team_work_state (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  reconciled_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
