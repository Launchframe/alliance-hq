-- THP / kills screenshot OCR job audit trail for maintainer inspection
CREATE TABLE IF NOT EXISTS screenshot_ocr_jobs (
  id text PRIMARY KEY,
  source text NOT NULL,
  alliance_id text,
  hq_user_id text,
  discord_user_id text,
  source_width integer NOT NULL,
  source_height integer NOT NULL,
  modal_rect_json jsonb,
  modal_method text,
  parsed_ok integer NOT NULL DEFAULT 0,
  parsed_value bigint,
  entry_count integer,
  complete integer NOT NULL DEFAULT 0,
  quality_json jsonb,
  diagnostics_json jsonb,
  artifacts_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS screenshot_ocr_jobs_created_at_idx
  ON screenshot_ocr_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS screenshot_ocr_jobs_source_idx
  ON screenshot_ocr_jobs (source);
