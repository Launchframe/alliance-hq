-- Review timing + rater identity for closed-loop video hygiene learning.
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_opened_at" timestamp with time zone;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_duration_ms" integer;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "rated_by_hq_user_id" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_rows_saved" integer;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_rows_edited" integer;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_rows_deleted" integer;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "review_rows_added" integer;

DO $$ BEGIN
  ALTER TABLE "video_jobs"
    ADD CONSTRAINT "video_jobs_rated_by_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("rated_by_hq_user_id") REFERENCES "hq_users"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Append-only coach/adapt decision log (writers land in later slices).
CREATE TABLE IF NOT EXISTS "video_hygiene_events" (
  "id" text PRIMARY KEY NOT NULL,
  "hq_user_id" text NOT NULL,
  "score_target" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb,
  "job_id" text,
  "alliance_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "video_hygiene_events"
    ADD CONSTRAINT "video_hygiene_events_hq_user_id_hq_users_id_fk"
    FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id")
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "video_hygiene_events"
    ADD CONSTRAINT "video_hygiene_events_job_id_video_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "video_jobs"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "video_hygiene_events_user_target_created_idx"
  ON "video_hygiene_events" ("hq_user_id", "score_target", "created_at");

CREATE INDEX IF NOT EXISTS "video_hygiene_events_kind_created_idx"
  ON "video_hygiene_events" ("kind", "created_at");
