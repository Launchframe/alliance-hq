-- Nullable UID + server-scoped orphan Commander identity; backfill roster members.

ALTER TABLE "commanders" ALTER COLUMN "game_uid" DROP NOT NULL;

ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "game_server_number" integer;
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "primary_name_normalized" text;

DROP INDEX IF EXISTS "commanders_game_uid_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "commanders_game_uid_unique"
  ON "commanders" ("game_uid")
  WHERE "game_uid" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "commanders_orphan_name_server_unique"
  ON "commanders" ("primary_name_normalized", "game_server_number")
  WHERE "game_uid" IS NULL
    AND "primary_name_normalized" IS NOT NULL
    AND "game_server_number" IS NOT NULL;

ALTER TABLE "alliance_members"
  ADD COLUMN IF NOT EXISTS "commander_sync_status" text DEFAULT 'pending' NOT NULL;

ALTER TABLE "alliance_members"
  ADD COLUMN IF NOT EXISTS "commander_conflict_json" jsonb;

UPDATE "commanders"
SET "primary_name_normalized" = lower(trim(regexp_replace("primary_name", '\s+', ' ', 'g')))
WHERE "primary_name" IS NOT NULL
  AND trim("primary_name") <> ''
  AND "primary_name_normalized" IS NULL;

UPDATE "commanders" c
SET "game_server_number" = a."game_server_number"
FROM "commander_alliance_memberships" cam
INNER JOIN "alliances" a ON a."id" = cam."alliance_id"
WHERE cam."commander_id" = c."id"
  AND c."game_server_number" IS NULL
  AND a."game_server_number" IS NOT NULL;

-- Orphan commanders for roster rows without commander membership (UID-known first).
INSERT INTO "commanders" (
  "id",
  "game_uid",
  "game_server_number",
  "primary_name",
  "primary_name_normalized",
  "profession",
  "professional_level",
  "member_level",
  "hero_power_m",
  "power_level",
  "current_kills",
  "current_total_hero_power",
  "current_squad_power_json",
  "created_at",
  "updated_at"
)
SELECT
  'cmd_' || md5('orphan:' || am."alliance_id" || ':' || am."ashed_member_id"),
  NULL,
  a."game_server_number",
  am."current_name",
  lower(trim(regexp_replace(am."current_name", '\s+', ' ', 'g'))),
  am."profession",
  am."professional_level",
  am."member_level",
  am."hero_power_m",
  am."power_level",
  am."current_kills",
  am."current_total_hero_power",
  am."current_squad_power_json",
  am."created_at",
  am."updated_at"
FROM "alliance_members" am
INNER JOIN "alliances" a ON a."id" = am."alliance_id"
WHERE a."game_server_number" IS NOT NULL
  AND trim(am."current_name") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "commander_alliance_memberships" cam
    WHERE cam."alliance_id" = am."alliance_id"
      AND cam."ashed_member_id" = am."ashed_member_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "commanders" c
    WHERE c."game_uid" IS NULL
      AND c."primary_name_normalized" = lower(trim(regexp_replace(am."current_name", '\s+', ' ', 'g')))
      AND c."game_server_number" = a."game_server_number"
  )
ON CONFLICT DO NOTHING;

INSERT INTO "commander_alliance_memberships" (
  "id",
  "commander_id",
  "alliance_id",
  "ashed_member_id",
  "ashed_alliance_id",
  "status",
  "joined_at",
  "left_at",
  "alliance_rank",
  "alliance_rank_title",
  "roster_name_at_membership",
  "created_at",
  "updated_at"
)
SELECT
  'cam_' || md5(am."alliance_id" || ':' || am."ashed_member_id"),
  c."id",
  am."alliance_id",
  am."ashed_member_id",
  am."ashed_alliance_id",
  CASE WHEN am."status" = 'active' THEN 'active' ELSE 'former' END,
  am."created_at",
  CASE WHEN am."status" = 'active' THEN NULL ELSE am."updated_at" END,
  am."alliance_rank",
  am."alliance_rank_title",
  am."current_name",
  am."created_at",
  am."updated_at"
FROM "alliance_members" am
INNER JOIN "alliances" a ON a."id" = am."alliance_id"
INNER JOIN "commanders" c
  ON c."game_uid" IS NULL
  AND c."primary_name_normalized" = lower(trim(regexp_replace(am."current_name", '\s+', ' ', 'g')))
  AND c."game_server_number" = a."game_server_number"
WHERE a."game_server_number" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "commander_alliance_memberships" cam
    WHERE cam."alliance_id" = am."alliance_id"
      AND cam."ashed_member_id" = am."ashed_member_id"
  )
ON CONFLICT ("alliance_id", "ashed_member_id") DO NOTHING;

UPDATE "alliance_members" am
SET "commander_sync_status" = 'synced',
    "commander_conflict_json" = NULL
WHERE EXISTS (
  SELECT 1 FROM "commander_alliance_memberships" cam
  WHERE cam."alliance_id" = am."alliance_id"
    AND cam."ashed_member_id" = am."ashed_member_id"
);

UPDATE "alliance_members" am
SET "commander_sync_status" = 'name_conflict',
    "commander_conflict_json" = jsonb_build_object(
      'code', 'name_taken_by_other_member',
      'normalizedName', lower(trim(regexp_replace(am."current_name", '\s+', ' ', 'g'))),
      'gameServerNumber', a."game_server_number"
    )
FROM "alliances" a
WHERE am."alliance_id" = a."id"
  AND a."game_server_number" IS NOT NULL
  AND trim(am."current_name") <> ''
  AND am."commander_sync_status" = 'pending'
  AND EXISTS (
    SELECT 1 FROM "commanders" c
    INNER JOIN "commander_alliance_memberships" cam ON cam."commander_id" = c."id"
    WHERE c."game_uid" IS NULL
      AND c."primary_name_normalized" = lower(trim(regexp_replace(am."current_name", '\s+', ' ', 'g')))
      AND c."game_server_number" = a."game_server_number"
      AND cam."alliance_id" = am."alliance_id"
      AND cam."ashed_member_id" <> am."ashed_member_id"
  );

UPDATE "alliance_members" am
SET "commander_sync_status" = 'missing_server'
FROM "alliances" a
WHERE am."alliance_id" = a."id"
  AND am."commander_sync_status" = 'pending'
  AND a."game_server_number" IS NULL;
