-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS ocr_media_policies (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  policy jsonb NOT NULL,
  updated_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ocr_media_tasks (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  source_run_id text REFERENCES ocr_pipeline_runs(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  expected_sha256 text NOT NULL,
  staging_key text NOT NULL,
  source_key text NOT NULL,
  upload_id text,
  policy_revision integer NOT NULL,
  policy_snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'queued', 'running', 'ready', 'failed', 'revoked')),
  lease_token text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  expires_at timestamptz NOT NULL,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_media_request_unique UNIQUE (alliance_id, request_id)
);
CREATE INDEX IF NOT EXISTS ocr_media_queue_idx ON ocr_media_tasks(state, lease_expires_at);
CREATE TABLE IF NOT EXISTS ocr_media_objects (
  storage_key text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES ocr_media_tasks(id),
  kind text NOT NULL CHECK (kind IN ('staging', 'source', 'frame')),
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes > 0),
  sha256 text,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'ready', 'garbage', 'deleted')),
  delete_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_media_quota_idx ON ocr_media_objects(alliance_id, state);
CREATE INDEX IF NOT EXISTS ocr_media_expiry_idx ON ocr_media_objects(delete_after);
