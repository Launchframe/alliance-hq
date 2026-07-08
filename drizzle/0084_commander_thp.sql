ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "current_thp_breakdown" jsonb;
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "thp_updated_at" timestamptz;

CREATE TABLE IF NOT EXISTS "commander_thp_events" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "total" double precision NOT NULL,
  "breakdown" jsonb,
  "previous_total" double precision,
  "source" text NOT NULL,
  "alliance_id" text REFERENCES "alliances"("id") ON DELETE SET NULL,
  "reported_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "reported_by_discord_user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commander_thp_events_commander_created_idx"
  ON "commander_thp_events" ("commander_id", "created_at");

CREATE INDEX IF NOT EXISTS "commander_thp_events_alliance_created_idx"
  ON "commander_thp_events" ("alliance_id", "created_at");

CREATE TABLE IF NOT EXISTS "hq_thp_pending" (
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
  "pending_json" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "hq_thp_pending_alliance_hq_user_pk" PRIMARY KEY ("alliance_id", "hq_user_id")
);
