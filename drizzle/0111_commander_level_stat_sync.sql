ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "level_updated_at" timestamptz;

CREATE TABLE IF NOT EXISTS "commander_level_events" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "total" integer NOT NULL,
  "previous_total" integer,
  "source" text NOT NULL,
  "alliance_id" text REFERENCES "alliances"("id") ON DELETE SET NULL,
  "reported_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "reported_by_discord_user_id" text,
  "ashed_synced_at" timestamptz,
  "discarded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commander_level_events_commander_created_idx"
  ON "commander_level_events" ("commander_id", "created_at");

CREATE INDEX IF NOT EXISTS "commander_level_events_alliance_created_idx"
  ON "commander_level_events" ("alliance_id", "created_at");
