-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS ocr_learning_cases (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  score_target text NOT NULL CHECK (score_target IN ('vs-performance', 'alliance-kills-video')),
  source_job_id text,
  source_storage_key text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_bytes bigint NOT NULL CHECK (source_bytes > 0),
  file_name text NOT NULL,
  recording_group_id text NOT NULL,
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'verified', 'excluded', 'revoked')),
  pairing text NOT NULL DEFAULT 'unmatched' CHECK (pairing IN ('unmatched', 'confirmed', 'rejected')),
  label_revision integer NOT NULL DEFAULT 0 CHECK (label_revision >= 0),
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocr_cases_scope_idx ON ocr_learning_cases(alliance_id, score_target, state);
CREATE INDEX IF NOT EXISTS ocr_cases_source_idx ON ocr_learning_cases(alliance_id, source_sha256);
CREATE INDEX IF NOT EXISTS ocr_cases_expiry_idx ON ocr_learning_cases(expires_at);
CREATE TABLE IF NOT EXISTS ocr_learning_case_revisions (
  case_id text NOT NULL REFERENCES ocr_learning_cases(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  recorded_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, revision)
);
CREATE TABLE IF NOT EXISTS ocr_dataset_versions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_dataset_manifest_unique UNIQUE (alliance_id, manifest_hash)
);
CREATE TABLE IF NOT EXISTS ocr_dataset_partitions (
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  split text NOT NULL CHECK (split IN ('train', 'validation', 'test')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alliance_id, fingerprint)
);
