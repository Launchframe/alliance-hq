ALTER TABLE "battle_plan_capture_events" ADD COLUMN IF NOT EXISTS "icon_preset" text;

UPDATE "battle_plan_capture_events" AS e
SET "icon_preset" = m."icon_preset"
FROM "battle_plan_markers" AS m
WHERE e."alliance_id" = m."alliance_id"
  AND e."marker_number" = m."marker_number"
  AND m."icon_preset" IS NOT NULL;

UPDATE "battle_plan_capture_events"
SET "icon_preset" = CASE "marker_number"
  WHEN 1 THEN 'ordinal-1'
  WHEN 2 THEN 'ordinal-2'
  WHEN 3 THEN 'ordinal-3'
  WHEN 4 THEN 'ordinal-4'
  WHEN 5 THEN 'ordinal-5'
END
WHERE "icon_preset" IS NULL;

ALTER TABLE "battle_plan_capture_events" DROP COLUMN IF EXISTS "marker_number";

DROP TABLE IF EXISTS "battle_plan_markers";
