ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "game_uid" text;

CREATE TABLE IF NOT EXISTS "member_alliance_tenure" (
  "id" text PRIMARY KEY NOT NULL,
  "game_uid" text NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "ashed_member_id" text NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "member_alliance_tenure_game_uid_idx"
  ON "member_alliance_tenure" ("game_uid");

CREATE INDEX IF NOT EXISTS "member_alliance_tenure_game_uid_alliance_idx"
  ON "member_alliance_tenure" ("game_uid", "alliance_id");

CREATE UNIQUE INDEX IF NOT EXISTS "member_alliance_tenure_active_member_unique"
  ON "member_alliance_tenure" ("alliance_id", "ashed_member_id")
  WHERE "left_at" IS NULL;
