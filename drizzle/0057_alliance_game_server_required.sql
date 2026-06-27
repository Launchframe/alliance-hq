-- Every alliance must be linked to a canonical game_servers row.
-- Existing rows with a server number get their missing server row/link created
-- before the NOT NULL constraints are applied.

INSERT INTO "game_seasons" ("id", "season_number", "max_base_vr", "created_at", "updated_at")
VALUES ('season-1', 1, 10000, now(), now())
ON CONFLICT ("season_number") DO NOTHING;

INSERT INTO "game_servers" (
  "id",
  "server_number",
  "season_id",
  "season_key_synced",
  "season_key_source",
  "season_is_post_season",
  "synced_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT
  'server-' || a."game_server_number",
  a."game_server_number",
  'season-1',
  COALESCE(a."season_key_synced", a."current_season_key", '1'),
  COALESCE(a."season_key_source", 'default'),
  COALESCE(a."season_is_post_season", 0),
  now(),
  now(),
  now()
FROM "alliances" a
WHERE a."game_server_number" IS NOT NULL
ON CONFLICT ("server_number") DO NOTHING;

UPDATE "alliances" a
SET "game_server_id" = gs."id",
    "updated_at" = now()
FROM "game_servers" gs
WHERE a."game_server_number" = gs."server_number"
  AND a."game_server_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "alliances"
    WHERE "game_server_number" IS NULL
       OR "game_server_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce required alliance game server: alliances with missing game_server_number or game_server_id remain';
  END IF;
END $$;

ALTER TABLE "alliances" DROP CONSTRAINT IF EXISTS "alliances_game_server_id_game_servers_id_fk";

DO $$ BEGIN
  ALTER TABLE "alliances" ADD CONSTRAINT "alliances_game_server_id_game_servers_id_fk"
    FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "alliances" ALTER COLUMN "game_server_number" SET NOT NULL;
ALTER TABLE "alliances" ALTER COLUMN "game_server_id" SET NOT NULL;
