-- Commander-scoped VR summary + events (portable across alliance transfers).
-- Legacy member_season_vr* tables are retained for dual-write / orphan fallback.

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
  CONSTRAINT "commander_season_vr_commander_season_unique" UNIQUE ("commander_id", "season_key")
);

CREATE INDEX IF NOT EXISTS "commander_season_vr_season_idx"
  ON "commander_season_vr" ("season_key");

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

-- Backfill summary rows via active/former memberships.
-- Duplicate (commander_id, season_key) rows merge with GREATEST(highest_base_vr).
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
  'csv-' || md5(cam."commander_id" || ':' || m."season_key"),
  cam."commander_id",
  m."season_key",
  MAX(m."highest_base_vr"),
  (
    ARRAY_AGG(m."institute_level" ORDER BY m."highest_base_vr" DESC, m."updated_at" DESC)
  )[1],
  (
    ARRAY_AGG(m."flagged_at" ORDER BY m."highest_base_vr" DESC, m."updated_at" DESC)
  )[1],
  (
    ARRAY_AGG(m."flag_reason" ORDER BY m."highest_base_vr" DESC, m."updated_at" DESC)
  )[1],
  (
    ARRAY_AGG(m."updated_by_discord_user_id" ORDER BY m."highest_base_vr" DESC, m."updated_at" DESC)
  )[1],
  (
    ARRAY_AGG(m."updated_by_hq_user_id" ORDER BY m."highest_base_vr" DESC, m."updated_at" DESC)
  )[1],
  MIN(m."created_at"),
  MAX(m."updated_at")
FROM "member_season_vr" m
INNER JOIN "commander_alliance_memberships" cam
  ON cam."alliance_id" = m."alliance_id"
 AND cam."ashed_member_id" = m."ashed_member_id"
GROUP BY cam."commander_id", m."season_key"
ON CONFLICT ("commander_id", "season_key") DO UPDATE SET
  "highest_base_vr" = GREATEST(
    "commander_season_vr"."highest_base_vr",
    EXCLUDED."highest_base_vr"
  ),
  "institute_level" = CASE
    WHEN EXCLUDED."highest_base_vr" >= "commander_season_vr"."highest_base_vr"
    THEN EXCLUDED."institute_level"
    ELSE "commander_season_vr"."institute_level"
  END,
  "flagged_at" = CASE
    WHEN EXCLUDED."highest_base_vr" >= "commander_season_vr"."highest_base_vr"
    THEN EXCLUDED."flagged_at"
    ELSE "commander_season_vr"."flagged_at"
  END,
  "flag_reason" = CASE
    WHEN EXCLUDED."highest_base_vr" >= "commander_season_vr"."highest_base_vr"
    THEN EXCLUDED."flag_reason"
    ELSE "commander_season_vr"."flag_reason"
  END,
  "updated_at" = GREATEST(
    "commander_season_vr"."updated_at",
    EXCLUDED."updated_at"
  );

-- Backfill event timeline (preserve ids when possible via new prefixed ids).
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
  'csve-' || e."id",
  cam."commander_id",
  e."season_key",
  e."base_vr",
  e."institute_level",
  e."previous_base_vr",
  e."source",
  e."alliance_id",
  e."reported_by_hq_user_id",
  e."reported_by_discord_user_id",
  e."created_at"
FROM "member_season_vr_events" e
INNER JOIN "commander_alliance_memberships" cam
  ON cam."alliance_id" = e."alliance_id"
 AND cam."ashed_member_id" = e."ashed_member_id"
ON CONFLICT ("id") DO NOTHING;
