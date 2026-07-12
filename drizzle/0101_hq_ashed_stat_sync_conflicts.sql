CREATE TABLE IF NOT EXISTS "hq_ashed_stat_sync_conflicts" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "stat" text NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "hq_total" double precision NOT NULL,
  "ashed_total" double precision NOT NULL,
  "hq_source" text,
  "hq_event_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "hq_ashed_stat_sync_conflicts_alliance_stat_commander_unique"
    UNIQUE ("alliance_id", "stat", "commander_id")
);

CREATE INDEX IF NOT EXISTS "hq_ashed_stat_sync_conflicts_alliance_stat_idx"
  ON "hq_ashed_stat_sync_conflicts" ("alliance_id", "stat");
