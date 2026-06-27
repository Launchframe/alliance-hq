CREATE TABLE IF NOT EXISTS "alliance_video_processors" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL,
  "hq_user_id" text NOT NULL,
  "granted_by_hq_user_id" text,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alliance_video_processors"
    ADD CONSTRAINT "alliance_video_processors_alliance_id_alliances_id_fk"
    FOREIGN KEY ("alliance_id") REFERENCES "alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alliance_video_processors"
    ADD CONSTRAINT "alliance_video_processors_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alliance_video_processors"
    ADD CONSTRAINT "alliance_video_processors_granted_by_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("granted_by_hq_user_id") REFERENCES "hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alliance_video_processors_alliance_user_idx"
  ON "alliance_video_processors" ("alliance_id", "hq_user_id");
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "enqueued_by_hq_user_id" text;
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "approved_by_hq_user_id" text;
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "processing_session_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "video_jobs"
    ADD CONSTRAINT "video_jobs_enqueued_by_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("enqueued_by_hq_user_id") REFERENCES "hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "video_jobs"
    ADD CONSTRAINT "video_jobs_approved_by_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("approved_by_hq_user_id") REFERENCES "hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "video_jobs"
    ADD CONSTRAINT "video_jobs_processing_session_id_sessions_id_fk"
    FOREIGN KEY ("processing_session_id") REFERENCES "sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
