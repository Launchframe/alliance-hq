ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "tag" text;

UPDATE "alliances" AS a
SET "tag" = s."alliance_tag"
FROM "sessions" AS s
WHERE s."current_alliance_id" = a."id"
  AND s."alliance_tag" IS NOT NULL
  AND (a."tag" IS NULL OR a."tag" = '');
