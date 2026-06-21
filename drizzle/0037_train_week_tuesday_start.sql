ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "train_week_start_dow" integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
UPDATE "train_week_schedules" AS "t"
SET "week_start" = to_char(("t"."week_start"::date + interval '1 day'), 'YYYY-MM-DD')
WHERE EXTRACT(DOW FROM "t"."week_start"::date) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "train_week_schedules" AS "dup"
    WHERE "dup"."alliance_id" = "t"."alliance_id"
      AND "dup"."week_start" = to_char(("t"."week_start"::date + interval '1 day'), 'YYYY-MM-DD')
      AND "dup"."id" <> "t"."id"
  );
--> statement-breakpoint
DELETE FROM "train_week_schedules" AS "t"
WHERE EXTRACT(DOW FROM "t"."week_start"::date) = 1
  AND EXISTS (
    SELECT 1
    FROM "train_week_schedules" AS "dup"
    WHERE "dup"."alliance_id" = "t"."alliance_id"
      AND "dup"."week_start" = to_char(("t"."week_start"::date + interval '1 day'), 'YYYY-MM-DD')
      AND "dup"."id" <> "t"."id"
  );
