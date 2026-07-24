-- Buster Day Efficiency: per-alliance VS-week snapshot bookkeeping.
CREATE TABLE IF NOT EXISTS "buster_day_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "vs_week_monday" text NOT NULL,
  "pre_snapshot_date" text,
  "pre_roster_job_id" text,
  "pre_kills_job_id" text,
  "pre_completed_at" timestamptz,
  "post_snapshot_date" text,
  "post_roster_job_id" text,
  "post_kills_job_id" text,
  "post_completed_at" timestamptz,
  "pre_reminder_sent_at" timestamptz,
  "post_reminder_sent_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "buster_day_reports_alliance_week_unique"
    UNIQUE ("alliance_id", "vs_week_monday")
);

CREATE INDEX IF NOT EXISTS "buster_day_reports_alliance_updated_idx"
  ON "buster_day_reports" ("alliance_id", "updated_at");
