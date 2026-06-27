-- Commander main squad + current alliance denormalization for alliance-scoped analysis.

ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "main_squad" text;--> statement-breakpoint
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "main_squad_source" text;--> statement-breakpoint
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "main_squad_updated_at" timestamptz;--> statement-breakpoint
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "current_alliance_id" text;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "commanders"
    ADD CONSTRAINT "commanders_current_alliance_id_alliances_id_fk"
    FOREIGN KEY ("current_alliance_id") REFERENCES "alliances"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "main_squad" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commanders_current_alliance_idx"
  ON "commanders" ("current_alliance_id")
  WHERE "current_alliance_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "alliance_members_alliance_active_thp_idx"
  ON "alliance_members" ("alliance_id", "current_total_hero_power" DESC NULLS LAST)
  WHERE "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "alliance_members_alliance_squad_thp_idx"
  ON "alliance_members" ("alliance_id", "main_squad", "current_total_hero_power" DESC NULLS LAST)
  WHERE "status" = 'active';--> statement-breakpoint

UPDATE "commanders" AS c
SET "current_alliance_id" = sub."alliance_id"
FROM (
  SELECT DISTINCT ON (cam."commander_id")
    cam."commander_id",
    cam."alliance_id"
  FROM "commander_alliance_memberships" AS cam
  WHERE cam."left_at" IS NULL
    AND cam."status" = 'active'
  ORDER BY cam."commander_id", cam."joined_at" DESC
) AS sub
WHERE c."id" = sub."commander_id";--> statement-breakpoint

UPDATE "alliance_members" AS am
SET "main_squad" = c."main_squad"
FROM "commander_alliance_memberships" AS cam
INNER JOIN "commanders" AS c ON c."id" = cam."commander_id"
WHERE cam."alliance_id" = am."alliance_id"
  AND cam."ashed_member_id" = am."ashed_member_id"
  AND cam."left_at" IS NULL
  AND cam."status" = 'active'
  AND c."main_squad" IS NOT NULL;
