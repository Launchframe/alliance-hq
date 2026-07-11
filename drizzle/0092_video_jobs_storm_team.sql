-- Persist storm Team A/B + recorded date on the video job so HQ keeps the
-- submit context alongside Ashed DesertStormScore / CanyonStormScore rows.
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "team" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "recorded_date" text;
