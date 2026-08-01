ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "bank_id" text;

DO $$ BEGIN
  ALTER TABLE "video_jobs"
    ADD CONSTRAINT "video_jobs_bank_id_banks_id_fk"
    FOREIGN KEY ("bank_id") REFERENCES "banks"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "video_jobs_alliance_bank_review_idx"
  ON "video_jobs" ("alliance_id", "bank_id")
  WHERE "bank_id" IS NOT NULL AND "status" = 'review';
