CREATE TABLE IF NOT EXISTS knowledge_workspace_preferences (
  hq_user_id text NOT NULL REFERENCES hq_users(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0 CONSTRAINT knowledge_workspace_preferences_version_check CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hq_user_id, alliance_id)
);
