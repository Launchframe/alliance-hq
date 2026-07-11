-- War Leader Support: WL team pairing system
-- wl_min_engs_per_team on alliances (officer-configurable, default 2)
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "wl_min_engs_per_team" integer NOT NULL DEFAULT 2;

-- One team per (alliance, WL commander)
CREATE TABLE IF NOT EXISTS "wl_teams" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "wl_commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "wl_teams_alliance_wl_unique"
  ON "wl_teams" ("alliance_id", "wl_commander_id");

-- Eng assignments to WL teams with optional coverage window
CREATE TABLE IF NOT EXISTS "wl_eng_assignments" (
  "id" text PRIMARY KEY,
  "wl_team_id" text NOT NULL REFERENCES "wl_teams"("id") ON DELETE CASCADE,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "eng_commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  -- active | dismissed | self_removed
  "status" text NOT NULL DEFAULT 'active',
  -- UTC hours 0-23, nullable until the Eng sets their window
  "coverage_start_hour" integer,
  "coverage_end_hour" integer,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "dismissed_at" timestamptz,
  "dismissed_by_commander_id" text REFERENCES "commanders"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "wl_eng_assignments_team_eng_unique"
  ON "wl_eng_assignments" ("wl_team_id", "eng_commander_id");
CREATE INDEX IF NOT EXISTS "wl_eng_assignments_alliance_idx"
  ON "wl_eng_assignments" ("alliance_id");
CREATE INDEX IF NOT EXISTS "wl_eng_assignments_eng_idx"
  ON "wl_eng_assignments" ("eng_commander_id");

-- Append-only activity log for officer feed
CREATE TABLE IF NOT EXISTS "wl_team_events" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "wl_team_id" text REFERENCES "wl_teams"("id") ON DELETE SET NULL,
  -- eng_assigned | eng_dismissed | eng_self_removed | more_engs_requested | profession_switched
  "event_kind" text NOT NULL,
  "actor_commander_id" text REFERENCES "commanders"("id") ON DELETE SET NULL,
  "subject_commander_id" text REFERENCES "commanders"("id") ON DELETE SET NULL,
  "details_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "wl_team_events_alliance_created_idx"
  ON "wl_team_events" ("alliance_id", "created_at" DESC);

-- Discord channels registered for profession table announcements
CREATE TABLE IF NOT EXISTS "profession_channels" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "guild_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "profession_channels_alliance_guild_unique"
  ON "profession_channels" ("alliance_id", "guild_id");
