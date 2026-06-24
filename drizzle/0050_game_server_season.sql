CREATE TABLE IF NOT EXISTS "game_seasons" (
  "id" text PRIMARY KEY NOT NULL,
  "season_number" integer NOT NULL,
  "max_profession_level" integer,
  "max_base_vr" integer DEFAULT 10000 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "game_seasons_season_number_unique" UNIQUE("season_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_servers" (
  "id" text PRIMARY KEY NOT NULL,
  "server_number" integer NOT NULL,
  "season_id" text NOT NULL,
  "open_timestamp_ms" bigint,
  "season_key_override" text,
  "season_key_synced" text,
  "season_key_source" text,
  "season_is_post_season" integer DEFAULT 0 NOT NULL,
  "season_week" integer,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "game_servers_server_number_unique" UNIQUE("server_number")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_season_id_game_seasons_id_fk"
    FOREIGN KEY ("season_id") REFERENCES "game_seasons"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_servers_season_id_idx" ON "game_servers" USING btree ("season_id");
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "game_server_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alliances" ADD CONSTRAINT "alliances_game_server_id_game_servers_id_fk"
    FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
INSERT INTO "game_seasons" ("id", "season_number", "max_base_vr", "created_at", "updated_at")
SELECT DISTINCT
  'season-' || season_num::text,
  season_num,
  10000,
  now(),
  now()
FROM (
  SELECT GREATEST(1, COALESCE(
    CASE WHEN TRIM("current_season_key") ~ '^[0-9]+$'
      THEN TRIM("current_season_key")::integer
      ELSE NULL
    END,
    1
  )) AS season_num
  FROM "alliances"
  WHERE "current_season_key" IS NOT NULL
) seasons
ON CONFLICT ("season_number") DO NOTHING;
--> statement-breakpoint
INSERT INTO "game_seasons" ("id", "season_number", "max_base_vr", "created_at", "updated_at")
VALUES ('season-1', 1, 10000, now(), now())
ON CONFLICT ("season_number") DO NOTHING;
--> statement-breakpoint
INSERT INTO "game_servers" (
  "id",
  "server_number",
  "season_id",
  "open_timestamp_ms",
  "season_key_override",
  "season_key_synced",
  "season_key_source",
  "season_is_post_season",
  "season_week",
  "synced_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (a."game_server_number")
  'server-' || a."game_server_number",
  a."game_server_number",
  COALESCE(
    (SELECT gs."id" FROM "game_seasons" gs
     WHERE gs."season_number" = GREATEST(1, COALESCE(
       CASE WHEN TRIM(a."current_season_key") ~ '^[0-9]+$'
         THEN TRIM(a."current_season_key")::integer
         ELSE NULL
       END,
       1
     ))
     LIMIT 1),
    'season-1'
  ),
  a."game_server_open_timestamp",
  a."season_key_override",
  a."season_key_synced",
  a."season_key_source",
  a."season_is_post_season",
  a."season_week",
  a."season_synced_at",
  now(),
  now()
FROM "alliances" a
WHERE a."game_server_number" IS NOT NULL
ORDER BY a."game_server_number", a."updated_at" DESC
ON CONFLICT ("server_number") DO NOTHING;
--> statement-breakpoint
UPDATE "alliances" a
SET "game_server_id" = 'server-' || a."game_server_number"
WHERE a."game_server_number" IS NOT NULL
  AND a."game_server_id" IS NULL
  AND EXISTS (SELECT 1 FROM "game_servers" gs WHERE gs."server_number" = a."game_server_number");
