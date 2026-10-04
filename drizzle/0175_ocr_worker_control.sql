CREATE TABLE IF NOT EXISTS ocr_worker_policies (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  policy jsonb NOT NULL,
  updated_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ocr_model_versions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  definition jsonb NOT NULL,
  training_job_id text UNIQUE,
  dataset_id text REFERENCES ocr_dataset_versions(id),
  artifact_id text,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'revoked')),
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_model_scope_idx ON ocr_model_versions(alliance_id, score_target);
CREATE TABLE IF NOT EXISTS ocr_worker_jobs (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  kind text NOT NULL CHECK (kind IN ('train', 'evaluate')),
  dataset_id text NOT NULL REFERENCES ocr_dataset_versions(id),
  pipeline_id text REFERENCES ocr_model_versions(id),
  request_id text NOT NULL,
  request_hash text NOT NULL,
  input jsonb NOT NULL,
  input_hash text NOT NULL,
  policy_revision integer NOT NULL,
  policy_snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'ready', 'failed', 'revoked')),
  lease_token text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result jsonb,
  metrics jsonb,
  result_hash text,
  error_code text,
  expires_at timestamptz NOT NULL,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_worker_request_unique UNIQUE (alliance_id, request_id)
);
CREATE INDEX IF NOT EXISTS ocr_worker_queue_idx ON ocr_worker_jobs(state, lease_expires_at);
CREATE TABLE IF NOT EXISTS ocr_worker_attempts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES ocr_worker_jobs(id),
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  worker_code_hash text NOT NULL,
  reserved_seconds integer NOT NULL CHECK (reserved_seconds > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT ocr_worker_attempt_unique UNIQUE (job_id, attempt)
);
CREATE INDEX IF NOT EXISTS ocr_worker_budget_idx ON ocr_worker_attempts(alliance_id, started_at);
CREATE TABLE IF NOT EXISTS ocr_worker_artifacts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES ocr_worker_jobs(id),
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  bytes bigint NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL,
  manifest_text text NOT NULL,
  manifest_hash text NOT NULL,
  staging_key text NOT NULL UNIQUE,
  sealed_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'sealed', 'deleted')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_worker_artifact_quota_idx ON ocr_worker_artifacts(alliance_id, state);
