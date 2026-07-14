CREATE TABLE IF NOT EXISTS "hq_vs_score_fixture_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "alliance_tag" text,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "hq_vs_scores" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "recorded_date" text NOT NULL,
  "member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "score" integer NOT NULL,
  "rank" integer,
  "source" text NOT NULL DEFAULT 'fixture_submit',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "hq_vs_scores"
    ADD CONSTRAINT "hq_vs_scores_alliance_date_member_unique"
    UNIQUE ("alliance_id", "recorded_date", "member_id");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "hq_vs_scores_alliance_date_idx"
  ON "hq_vs_scores" ("alliance_id", "recorded_date");

ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "fixture_id" text;
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "fixture_day_index" integer;
