CREATE TABLE plunder_plans (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  member_id text,
  membership_key text,
  kind text NOT NULL CHECK (kind IN ('plan', 'suggestion')),
  schedule jsonb NOT NULL CHECK (jsonb_typeof(schedule) = 'object'),
  source_id text,
  schedule_version integer NOT NULL DEFAULT 1 CHECK (schedule_version > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  removed boolean NOT NULL DEFAULT false,
  reminder boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'plan' AND member_id IS NOT NULL AND membership_key IS NOT NULL) OR (kind = 'suggestion' AND member_id IS NULL AND membership_key IS NULL AND reminder = false))
);
CREATE INDEX plunder_plans_alliance_idx ON plunder_plans(alliance_id, removed);
CREATE TABLE plunder_plan_exceptions (
  plan_id text NOT NULL REFERENCES plunder_plans(id) ON DELETE CASCADE,
  date text NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  schedule_version integer NOT NULL CHECK (schedule_version > 0),
  PRIMARY KEY (plan_id, date, schedule_version)
);
CREATE TABLE plunder_plan_colors (
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  color text NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alliance_id, principal_id)
);
CREATE TABLE plunder_plan_state (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE plunder_plan_intents (
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alliance_id, actor_id, request_id)
);
CREATE TABLE plunder_plan_interactions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  discord_user_id text NOT NULL,
  state jsonb NOT NULL,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE TABLE plunder_plan_digest_settings (
  guild_id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  time_st text NOT NULL CHECK (time_st ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  locale text NOT NULL CHECK (locale IN ('en-US', 'pt-BR')),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE plunder_plan_deliveries (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder', 'digest')),
  recipient_id text NOT NULL,
  occurrence_key text NOT NULL,
  due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'posting', 'sent', 'cancelled', 'uncertain')),
  lease_token text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  message_id text,
  CONSTRAINT plunder_plan_delivery_unique UNIQUE (alliance_id, kind, recipient_id, occurrence_key)
);
CREATE INDEX plunder_plan_delivery_due_idx ON plunder_plan_deliveries(status, due_at);
