-- Commander-scoped season VR (mirrors THP portability).
-- Legacy member_season_vr* tables are retained for dual-write / rollback.
--
-- Backfill joins via commander_alliance_memberships on (alliance_id, ashed_member_id).
-- Duplicate (commander_id, season_key) rows are collapsed before insert
-- (a commander may have VR rows in multiple alliances for the same season).
-- Orphan legacy rows (no resolvable commander) stay in member_season_vr* only.

CREATE TABLE IF NOT EXISTS "commander_season_vr" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "season_key" text NOT NULL,
  "highest_base_vr" integer NOT NULL,
  "institute_level" integer,
  "flagged_at" timestamptz,
  "flag_reason" text,
  "updated_by_discord_user_id" text,
  "updated_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commander_season_vr_commander_season_unique"
    UNIQUE ("commander_id", "season_key")
);

CREATE TABLE IF NOT EXISTS "commander_season_vr_events" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "season_key" text NOT NULL,
  "base_vr" integer NOT NULL,
  "institute_level" integer,
  "previous_base_vr" integer,
  "source" text NOT NULL,
  "alliance_id" text REFERENCES "alliances"("id") ON DELETE SET NULL,
  "reported_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "reported_by_discord_user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commander_season_vr_events_commander_season_created_idx"
  ON "commander_season_vr_events" ("commander_id", "season_key", "created_at");

CREATE INDEX IF NOT EXISTS "commander_season_vr_events_alliance_season_idx"
  ON "commander_season_vr_events" ("alliance_id", "season_key");

-- Summary backfill: collapse to one row per (commander_id, season_key) first.
-- Prefer highest VR, then newest updated_at. DISTINCT ON avoids
-- "ON CONFLICT DO UPDATE cannot affect row a second time".
INSERT INTO "commander_season_vr" (
  "id",
  "commander_id",
  "season_key",
  "highest_base_vr",
  "institute_level",
  "flagged_at",
  "flag_reason",
  "updated_by_discord_user_id",
  "updated_by_hq_user_id",
  "created_at",
  "updated_at"
)
SELECT
  src."id",
  src."commander_id",
  src."season_key",
  src."highest_base_vr",
  src."institute_level",
  src."flagged_at",
  src."flag_reason",
  src."updated_by_discord_user_id",
  src."updated_by_hq_user_id",
  src."created_at",
  src."updated_at"
FROM (
  SELECT DISTINCT ON (cam."commander_id", msv."season_key")
    msv."id",
    cam."commander_id",
    msv."season_key",
    msv."highest_base_vr",
    msv."institute_level",
    msv."flagged_at",
    msv."flag_reason",
    msv."updated_by_discord_user_id",
    msv."updated_by_hq_user_id",
    msv."created_at",
    msv."updated_at"
  FROM "member_season_vr" msv
  INNER JOIN "commander_alliance_memberships" cam
    ON cam."alliance_id" = msv."alliance_id"
   AND cam."ashed_member_id" = msv."ashed_member_id"
  ORDER BY
    cam."commander_id",
    msv."season_key",
    msv."highest_base_vr" DESC,
    msv."updated_at" DESC,
    msv."id"
) AS src
ON CONFLICT ("commander_id", "season_key") DO UPDATE SET
  "highest_base_vr" = GREATEST(
    "commander_season_vr"."highest_base_vr",
    EXCLUDED."highest_base_vr"
  ),
  "institute_level" = CASE
    WHEN EXCLUDED."highest_base_vr" > "commander_season_vr"."highest_base_vr"
      THEN EXCLUDED."institute_level"
    WHEN EXCLUDED."highest_base_vr" = "commander_season_vr"."highest_base_vr"
      AND EXCLUDED."updated_at" > "commander_season_vr"."updated_at"
      THEN EXCLUDED."institute_level"
    ELSE "commander_season_vr"."institute_level"
  END,
  "flagged_at" = CASE
    WHEN EXCLUDED."highest_base_vr" > "commander_season_vr"."highest_base_vr"
      THEN EXCLUDED."flagged_at"
    WHEN EXCLUDED."highest_base_vr" = "commander_season_vr"."highest_base_vr"
      AND EXCLUDED."updated_at" > "commander_season_vr"."updated_at"
      THEN EXCLUDED."flagged_at"
    ELSE "commander_season_vr"."flagged_at"
  END,
  "flag_reason" = CASE
    WHEN EXCLUDED."highest_base_vr" > "commander_season_vr"."highest_base_vr"
      THEN EXCLUDED."flag_reason"
    WHEN EXCLUDED."highest_base_vr" = "commander_season_vr"."highest_base_vr"
      AND EXCLUDED."updated_at" > "commander_season_vr"."updated_at"
      THEN EXCLUDED."flag_reason"
    ELSE "commander_season_vr"."flag_reason"
  END,
  "updated_by_discord_user_id" = CASE
    WHEN EXCLUDED."updated_at" > "commander_season_vr"."updated_at"
      THEN EXCLUDED."updated_by_discord_user_id"
    ELSE "commander_season_vr"."updated_by_discord_user_id"
  END,
  "updated_by_hq_user_id" = CASE
    WHEN EXCLUDED."updated_at" > "commander_season_vr"."updated_at"
      THEN EXCLUDED."updated_by_hq_user_id"
    ELSE "commander_season_vr"."updated_by_hq_user_id"
  END,
  "updated_at" = GREATEST(
    "commander_season_vr"."updated_at",
    EXCLUDED."updated_at"
  ),
  "created_at" = LEAST(
    "commander_season_vr"."created_at",
    EXCLUDED."created_at"
  );

-- Event backfill (preserve ids / timestamps / alliance context).
-- Deduplicate by event id in case a membership join is ambiguous.
INSERT INTO "commander_season_vr_events" (
  "id",
  "commander_id",
  "season_key",
  "base_vr",
  "institute_level",
  "previous_base_vr",
  "source",
  "alliance_id",
  "reported_by_hq_user_id",
  "reported_by_discord_user_id",
  "created_at"
)
SELECT
  src."id",
  src."commander_id",
  src."season_key",
  src."base_vr",
  src."institute_level",
  src."previous_base_vr",
  src."source",
  src."alliance_id",
  src."reported_by_hq_user_id",
  src."reported_by_discord_user_id",
  src."created_at"
FROM (
  SELECT DISTINCT ON (msve."id")
    msve."id",
    cam."commander_id",
    msve."season_key",
    msve."base_vr",
    msve."institute_level",
    msve."previous_base_vr",
    msve."source",
    msve."alliance_id",
    msve."reported_by_hq_user_id",
    msve."reported_by_discord_user_id",
    msve."created_at"
  FROM "member_season_vr_events" msve
  INNER JOIN "commander_alliance_memberships" cam
    ON cam."alliance_id" = msve."alliance_id"
   AND cam."ashed_member_id" = msve."ashed_member_id"
  ORDER BY
    msve."id",
    cam."joined_at" DESC NULLS LAST,
    cam."id"
) AS src
ON CONFLICT ("id") DO NOTHING;

-- Validation (run manually on prod after migrate):
-- SELECT COUNT(*) FROM member_season_vr;
-- SELECT COUNT(*) FROM commander_season_vr;
-- SELECT COUNT(*) FROM member_season_vr msv
--   LEFT JOIN commander_alliance_memberships cam
--     ON cam.alliance_id = msv.alliance_id AND cam.ashed_member_id = msv.ashed_member_id
--  WHERE cam.commander_id IS NULL;  -- orphan count
