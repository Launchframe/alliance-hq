ALTER TABLE "battle_plan_capture_events" ADD COLUMN "game_server_number" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN "coord_x" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN "coord_y" integer;
ALTER TABLE "battle_plan_capture_events" ADD COLUMN "level" integer;

ALTER TABLE "inbox_reminder_items" ADD COLUMN "capture_event_id" text;
ALTER TABLE "inbox_reminder_items" ADD COLUMN "visible_after" timestamp with time zone;
