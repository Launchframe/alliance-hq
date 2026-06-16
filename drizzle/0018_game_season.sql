ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "game_server_number" integer;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "game_server_open_timestamp" bigint;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_key_override" text;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_key_synced" text;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_key_source" text;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_synced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_is_post_season" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "season_week" integer;
--> statement-breakpoint
ALTER TABLE "train_week_schedules" ADD COLUMN IF NOT EXISTS "season_key" text;
--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "season_key" text;
--> statement-breakpoint
UPDATE "train_week_schedules" SET "season_key" = COALESCE(
  (SELECT "current_season_key" FROM "alliances" WHERE "alliances"."id" = "train_week_schedules"."alliance_id"),
  '1'
) WHERE "season_key" IS NULL;
--> statement-breakpoint
UPDATE "train_conductor_records" SET "season_key" = COALESCE(
  (SELECT "current_season_key" FROM "alliances" WHERE "alliances"."id" = "train_conductor_records"."alliance_id"),
  '1'
) WHERE "season_key" IS NULL;
