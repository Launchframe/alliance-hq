CREATE TABLE IF NOT EXISTS support_team_boards (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  published boolean NOT NULL DEFAULT false,
  construction jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_team_fields (
  alliance_id text NOT NULL REFERENCES support_team_boards(alliance_id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb,
  version integer NOT NULL CHECK (version > 0),
  action_id text NOT NULL,
  PRIMARY KEY (alliance_id, key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_team_events (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES support_team_boards(alliance_id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  board_version integer NOT NULL CHECK (board_version > 0),
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_team_events_intent_unique UNIQUE (alliance_id, principal_id, idempotency_key),
  CONSTRAINT support_team_events_version_unique UNIQUE (alliance_id, board_version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_team_reversals (
  alliance_id text NOT NULL REFERENCES support_team_boards(alliance_id) ON DELETE CASCADE,
  action_id text NOT NULL REFERENCES support_team_events(id),
  reversal_id text NOT NULL REFERENCES support_team_events(id),
  PRIMARY KEY (alliance_id, action_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_team_preferences (
  hq_user_id text PRIMARY KEY REFERENCES hq_users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  display jsonb NOT NULL
);
--> statement-breakpoint
INSERT INTO permissions (id, description) VALUES
  ('support_teams:read', 'Support teams'),
  ('support_teams:write', 'Support teams')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.id IN ('role-owner', 'role-maintainer', 'role-officer')
  AND p.id IN ('support_teams:read', 'support_teams:write')
ON CONFLICT DO NOTHING;
