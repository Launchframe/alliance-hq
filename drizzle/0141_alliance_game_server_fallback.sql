-- Backfill missing alliance game server links on stale preview DB rows.
-- Appended after 0057; do not edit applied migrations (hash-based replay).

INSERT INTO "game_seasons" ("id", "season_number", "created_at", "updated_at")
VALUES ('season-1', 1, now(), now())
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
VALUES (
  'server-unknown',
  0,
  'season-1',
  '1',
  'default',
  0,
  now(),
  now(),
  now()
)
ON CONFLICT ("server_number") DO NOTHING;

UPDATE "alliances" a
SET "game_server_number" = COALESCE(a."game_server_number", 0),
    "game_server_id" = COALESCE(
      a."game_server_id",
      (SELECT gs."id" FROM "game_servers" gs WHERE gs."server_number" = COALESCE(a."game_server_number", 0) LIMIT 1)
    ),
    "updated_at" = now()
WHERE a."game_server_number" IS NULL
   OR a."game_server_id" IS NULL;
