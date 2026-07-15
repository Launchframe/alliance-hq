ALTER TABLE "battle_plan_capture_events" ADD COLUMN IF NOT EXISTS "game_server_number" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN IF NOT EXISTS "coord_x" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN IF NOT EXISTS "coord_y" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN IF NOT EXISTS "level" integer;

ALTER TABLE "inbox_reminder_items" ADD COLUMN IF NOT EXISTS "capture_event_id" text;
ALTER TABLE "inbox_reminder_items" ADD COLUMN IF NOT EXISTS "visible_after" timestamp with time zone;
