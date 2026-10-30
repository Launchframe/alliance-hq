ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "roster_ashed_sync_status" text DEFAULT 'idle' NOT NULL;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "roster_ashed_sync_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "roster_ashed_sync_finished_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "roster_ashed_sync_last_error_code" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alliances" ADD CONSTRAINT "alliances_roster_ashed_sync_status_check"
    CHECK ("roster_ashed_sync_status" IN ('idle', 'running', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
