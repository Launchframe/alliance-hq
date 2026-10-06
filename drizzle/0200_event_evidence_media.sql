ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "event_context" jsonb;
--> statement-breakpoint
ALTER TABLE "video_upload_groups" ADD COLUMN IF NOT EXISTS "event_context" jsonb;
--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "event_evidence" jsonb;
