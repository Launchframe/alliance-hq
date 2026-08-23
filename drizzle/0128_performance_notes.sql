CREATE TABLE performance_notes (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  kind text NOT NULL,
  intake_mode text NOT NULL,
  body text NOT NULL,
  source text NOT NULL,
  created_by_discord_user_id text,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  expunged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX performance_notes_alliance_created_idx
  ON performance_notes (alliance_id, created_at);

CREATE INDEX performance_notes_alliance_kind_idx
  ON performance_notes (alliance_id, kind);

CREATE TABLE performance_note_members (
  id text PRIMARY KEY,
  note_id text NOT NULL REFERENCES performance_notes(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  alliance_member_id text REFERENCES alliance_members(id) ON DELETE SET NULL,
  ashed_member_id text NOT NULL,
  member_name_raw text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX performance_note_members_note_idx
  ON performance_note_members (note_id);

CREATE INDEX performance_note_members_alliance_ashed_idx
  ON performance_note_members (alliance_id, ashed_member_id);

CREATE UNIQUE INDEX performance_note_members_note_ashed_unique
  ON performance_note_members (note_id, ashed_member_id);
