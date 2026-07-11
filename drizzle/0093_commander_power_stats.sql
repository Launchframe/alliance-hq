-- Consolidate Power Level and THP onto commanders; drop duplicate stat columns from alliance_members.

CREATE TABLE IF NOT EXISTS "commander_power_level_events" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "value" text NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamptz DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commander_power_level_events_commander_date_idx"
  ON "commander_power_level_events" ("commander_id", "recorded_date");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commander_power_level_events_alliance_date_idx"
  ON "commander_power_level_events" ("alliance_id", "recorded_date");--> statement-breakpoint

-- Migrate legacy hero_power_m into power_level display string when missing.
-- Guard: preview DBs may have already dropped hero_power_m from a prior partial apply.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commanders'
      AND column_name = 'hero_power_m'
  ) THEN
    UPDATE "commanders"
    SET "power_level" = trim(to_char("hero_power_m", 'FM999999990.0')) || 'M'
    WHERE "power_level" IS NULL
      AND "hero_power_m" IS NOT NULL
      AND "hero_power_m" > 0;
  END IF;
END $$;--> statement-breakpoint

-- Backfill commander stats from alliance_members when those columns still exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alliance_members'
      AND column_name = 'power_level'
  ) THEN
    UPDATE "commanders" AS c
    SET
      "profession" = COALESCE(c."profession", am."profession"),
      "professional_level" = COALESCE(c."professional_level", am."professional_level"),
      "member_level" = COALESCE(c."member_level", am."member_level"),
      "power_level" = COALESCE(c."power_level", am."power_level"),
      "current_kills" = COALESCE(c."current_kills", am."current_kills"),
      "current_total_hero_power" = COALESCE(c."current_total_hero_power", am."current_total_hero_power"),
      "current_squad_power_json" = COALESCE(c."current_squad_power_json", am."current_squad_power_json"),
      "updated_at" = GREATEST(c."updated_at", am."updated_at")
    FROM "commander_alliance_memberships" AS cam
    INNER JOIN "alliance_members" AS am
      ON am."alliance_id" = cam."alliance_id"
     AND am."ashed_member_id" = cam."ashed_member_id"
    WHERE cam."commander_id" = c."id"
      AND cam."left_at" IS NULL;
  END IF;
END $$;--> statement-breakpoint

INSERT INTO "commander_thp_events" (
  "id",
  "commander_id",
  "total",
  "breakdown",
  "previous_total",
  "source",
  "alliance_id",
  "reported_by_hq_user_id",
  "reported_by_discord_user_id",
  "created_at"
)
SELECT
  'mthp_' || md5(m."id" || ':' || m."alliance_id" || ':' || m."ashed_member_id"),
  cam."commander_id",
  m."value",
  NULL,
  NULL,
  m."source",
  m."alliance_id",
  m."recorded_by_hq_user_id",
  NULL,
  COALESCE(m."recorded_at", now())
FROM "member_total_hero_power_events" AS m
INNER JOIN "commander_alliance_memberships" AS cam
  ON cam."alliance_id" = m."alliance_id"
 AND cam."ashed_member_id" = m."ashed_member_id"
 AND cam."left_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "commander_power_level_events" (
  "id",
  "commander_id",
  "alliance_id",
  "value",
  "recorded_date",
  "source",
  "recorded_at",
  "recorded_by_hq_user_id"
)
SELECT
  'mpl_' || md5(m."id" || ':' || m."alliance_id" || ':' || m."ashed_member_id"),
  cam."commander_id",
  m."alliance_id",
  m."value",
  m."recorded_date",
  m."source",
  COALESCE(m."recorded_at", now()),
  m."recorded_by_hq_user_id"
FROM "member_power_level_events" AS m
INNER JOIN "commander_alliance_memberships" AS cam
  ON cam."alliance_id" = m."alliance_id"
 AND cam."ashed_member_id" = m."ashed_member_id"
 AND cam."left_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

DROP INDEX IF EXISTS "alliance_members_alliance_active_thp_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "alliance_members_alliance_squad_thp_idx";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commanders_alliance_active_thp_idx"
  ON "commanders" ("current_alliance_id", "current_total_hero_power" DESC NULLS LAST)
  WHERE "current_total_hero_power" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commanders_alliance_squad_thp_idx"
  ON "commanders" ("current_alliance_id", "main_squad", "current_total_hero_power" DESC NULLS LAST)
  WHERE "current_total_hero_power" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "hero_power_m";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "member_level";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "profession";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "professional_level";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "power_level";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "current_kills";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "current_total_hero_power";--> statement-breakpoint
ALTER TABLE "alliance_members" DROP COLUMN IF EXISTS "current_squad_power_json";--> statement-breakpoint

ALTER TABLE "commanders" DROP COLUMN IF EXISTS "hero_power_m";
