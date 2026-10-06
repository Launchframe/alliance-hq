ALTER TABLE "knowledge_history_imports" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD COLUMN IF NOT EXISTS "source_video_job_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD COLUMN IF NOT EXISTS "source_delete_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD COLUMN IF NOT EXISTS "source_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_history_assets" ADD COLUMN IF NOT EXISTS "r2_upload_id" text;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "reply_to_message_id" text;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "reply_match_confidence" real;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "coordinates" jsonb;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "extraction_confidence" real;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD COLUMN IF NOT EXISTS "parser_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "knowledge_import_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" DROP CONSTRAINT IF EXISTS "knowledge_history_imports_audience_check";--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD CONSTRAINT "knowledge_history_imports_audience_check" CHECK ("knowledge_history_imports"."audience" in ('private', 'officers_read'));--> statement-breakpoint
ALTER TABLE "officer_chat_messages" DROP CONSTRAINT IF EXISTS "officer_chat_messages_reply_confidence_check";--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_reply_confidence_check" CHECK ("officer_chat_messages"."reply_match_confidence" is null or ("officer_chat_messages"."reply_match_confidence" >= 0 and "officer_chat_messages"."reply_match_confidence" <= 1));--> statement-breakpoint
ALTER TABLE "officer_chat_messages" DROP CONSTRAINT IF EXISTS "officer_chat_messages_extraction_confidence_check";--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_extraction_confidence_check" CHECK ("officer_chat_messages"."extraction_confidence" is null or ("officer_chat_messages"."extraction_confidence" >= 0 and "officer_chat_messages"."extraction_confidence" <= 1));--> statement-breakpoint
ALTER TABLE "officer_chat_messages" DROP CONSTRAINT IF EXISTS "officer_chat_messages_review_reasons_check";--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_review_reasons_check" CHECK (jsonb_typeof("officer_chat_messages"."review_reasons") = 'array');--> statement-breakpoint
ALTER TABLE "officer_chat_messages" DROP CONSTRAINT IF EXISTS "officer_chat_messages_coordinates_check";--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_coordinates_check" CHECK ("officer_chat_messages"."coordinates" is null or (jsonb_typeof("officer_chat_messages"."coordinates") = 'object' and ("officer_chat_messages"."coordinates" -> 'server' is null or jsonb_typeof("officer_chat_messages"."coordinates" -> 'server') in ('number', 'null')) and jsonb_typeof("officer_chat_messages"."coordinates" -> 'x') = 'number' and jsonb_typeof("officer_chat_messages"."coordinates" -> 'y') = 'number' and ("officer_chat_messages"."coordinates" -> 'label' is null or jsonb_typeof("officer_chat_messages"."coordinates" -> 'label') in ('null', 'string'))));--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'officer_chat_sessions'::regclass AND conname = 'officer_chat_sessions_id_alliance_unique') THEN
		ALTER TABLE "officer_chat_sessions" ADD CONSTRAINT "officer_chat_sessions_id_alliance_unique" UNIQUE("id","alliance_id");
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'officer_chat_messages'::regclass AND conname = 'officer_chat_messages_id_session_alliance_unique') THEN
		ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_id_session_alliance_unique" UNIQUE("id","session_id","alliance_id");
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "officer_chat_messages" DROP CONSTRAINT IF EXISTS "officer_chat_messages_reply_fk";--> statement-breakpoint
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_reply_fk" FOREIGN KEY ("reply_to_message_id","session_id","alliance_id") REFERENCES "public"."officer_chat_messages"("id","session_id","alliance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" DROP CONSTRAINT IF EXISTS "knowledge_history_imports_source_video_job_fk";--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD CONSTRAINT "knowledge_history_imports_source_video_job_fk" FOREIGN KEY ("source_video_job_id") REFERENCES "public"."video_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" DROP CONSTRAINT IF EXISTS "video_jobs_knowledge_import_fk";--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_knowledge_import_fk" FOREIGN KEY ("knowledge_import_id") REFERENCES "public"."knowledge_history_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_history_imports_source_video_job_unique" ON "knowledge_history_imports" USING btree ("source_video_job_id") WHERE "source_video_job_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_jobs_knowledge_import_unique" ON "video_jobs" USING btree ("knowledge_import_id") WHERE "knowledge_import_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "officer_chat_messages_reply_idx" ON "officer_chat_messages" USING btree ("session_id","reply_to_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_jobs_knowledge_import_idx" ON "video_jobs" USING btree ("knowledge_import_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "officer_chat_message_media" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"alliance_id" text NOT NULL,
	"message_id" text,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_storage_key" text,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"source_frame_index" integer,
	"source_timestamp_ms" bigint,
	"sequence_order" integer NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "officer_chat_message_media_kind_check" CHECK ("officer_chat_message_media"."kind" in ('embedded', 'fullscreen'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "officer_chat_message_media" ADD CONSTRAINT "officer_chat_message_media_session_fk" FOREIGN KEY ("session_id","alliance_id") REFERENCES "public"."officer_chat_sessions"("id","alliance_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "officer_chat_message_media" ADD CONSTRAINT "officer_chat_message_media_message_fk" FOREIGN KEY ("message_id","session_id","alliance_id") REFERENCES "public"."officer_chat_messages"("id","session_id","alliance_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "officer_chat_message_media_sha_unique" ON "officer_chat_message_media" USING btree ("session_id","sha256","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "officer_chat_message_media_session_idx" ON "officer_chat_message_media" USING btree ("session_id","sequence_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "officer_chat_message_media_message_idx" ON "officer_chat_message_media" USING btree ("message_id");--> statement-breakpoint
INSERT INTO "knowledge_history_imports" ("id","alliance_id","resource_id","kind","state","source_hash","format_version","locale","audience","created_at","updated_at")
SELECT s."id", s."alliance_id", s."resource_id", 'screenshots', 'committed', 'legacy-officer-intel:' || s."id", 1, 'en-US', 'private', s."created_at", s."updated_at"
FROM "officer_chat_sessions" s
WHERE s."status" = 'imported'
AND NOT EXISTS (SELECT 1 FROM "knowledge_history_imports" i WHERE i."id" = s."id")
ON CONFLICT DO NOTHING;
