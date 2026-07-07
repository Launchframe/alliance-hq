CREATE TABLE IF NOT EXISTS "data_upload_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"score_target" text NOT NULL,
	"submit_entity" text NOT NULL,
	"recorded_date" text NOT NULL,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"source_job_id" text,
	"parse_session_id" text,
	"created_by_hq_user_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"moved_to_date" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_data_upload_batches_alliance_status"
	ON "data_upload_batches" ("alliance_id", "status");

CREATE INDEX IF NOT EXISTS "idx_data_upload_batches_alliance_entity_date"
	ON "data_upload_batches" ("alliance_id", "submit_entity", "recorded_date");

DO $$ BEGIN
 ALTER TABLE "data_upload_batches" ADD CONSTRAINT "data_upload_batches_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "data_upload_batches" ADD CONSTRAINT "data_upload_batches_source_job_id_video_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."video_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "data_upload_batches" ADD CONSTRAINT "data_upload_batches_parse_session_id_parse_sessions_id_fk" FOREIGN KEY ("parse_session_id") REFERENCES "public"."parse_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "data_upload_batches" ADD CONSTRAINT "data_upload_batches_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
