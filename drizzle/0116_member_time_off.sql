CREATE TABLE IF NOT EXISTS "member_time_off" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "notes" text,
  "availability" text NOT NULL DEFAULT 'full_away',
  "entry_kind" text NOT NULL DEFAULT 'planned',
  "source" text NOT NULL,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_by_discord_user_id" text,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "member_time_off_alliance_start_idx"
  ON "member_time_off" ("alliance_id", "start_date");

CREATE INDEX IF NOT EXISTS "member_time_off_alliance_member_idx"
  ON "member_time_off" ("alliance_id", "ashed_member_id");
