ALTER TABLE "parse_sessions"
  ADD COLUMN IF NOT EXISTS "dedupe_report_json" jsonb;
ALTER TABLE "parsed_rows"
  ADD COLUMN IF NOT EXISTS "dedupe_cluster_id" text;
