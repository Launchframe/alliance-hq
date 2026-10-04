-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS ocr_pipeline_runs (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  parse_session_id text NOT NULL UNIQUE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  engine text NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  source_sha256 text,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_runs_job_idx ON ocr_pipeline_runs(alliance_id, job_id);
CREATE TABLE IF NOT EXISTS ocr_feedback_events (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  parse_session_id text NOT NULL,
  run_id text REFERENCES ocr_pipeline_runs(id) ON DELETE SET NULL,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  kind text NOT NULL CHECK (kind IN ('submit', 'discard', 'rating', 'survey')),
  request_key text NOT NULL,
  request_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
  payload jsonb NOT NULL,
  recorded_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT ocr_feedback_request_unique UNIQUE (alliance_id, job_id, parse_session_id, kind, request_key)
);
CREATE INDEX IF NOT EXISTS ocr_feedback_pending_idx ON ocr_feedback_events(status, created_at);
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS ocr_feedback_receipt_id text;
