-- Append-only screenshot OCR hygiene events for learning loop (phase 3)
CREATE TABLE IF NOT EXISTS screenshot_hygiene_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  source text NOT NULL,
  screenshot_ocr_job_id text,
  alliance_id text,
  hq_user_id text,
  discord_user_id text,
  payload_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS screenshot_hygiene_events_created_at_idx
  ON screenshot_hygiene_events (created_at DESC);

CREATE INDEX IF NOT EXISTS screenshot_hygiene_events_hq_user_idx
  ON screenshot_hygiene_events (hq_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS screenshot_hygiene_events_discord_user_idx
  ON screenshot_hygiene_events (discord_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS screenshot_hygiene_events_job_idx
  ON screenshot_hygiene_events (screenshot_ocr_job_id);
