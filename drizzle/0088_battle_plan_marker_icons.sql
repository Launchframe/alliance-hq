ALTER TABLE "battle_plan_markers" ADD COLUMN IF NOT EXISTS "icon_preset" text;

UPDATE "battle_plan_markers"
SET "icon_preset" = CASE "marker_number"
  WHEN 1 THEN 'ordinal-1'
  WHEN 2 THEN 'ordinal-2'
  WHEN 3 THEN 'ordinal-3'
  WHEN 4 THEN 'ordinal-4'
  WHEN 5 THEN 'ordinal-5'
END
WHERE "icon_preset" IS NULL;
