-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS vs_score_heads (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  member_name text NOT NULL,
  recorded_date text NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'weekly')),
  score bigint CHECK (score >= 0 AND score <= 9007199254740991),
  origin text NOT NULL CHECK (origin IN ('hq', 'derived')),
  version integer NOT NULL DEFAULT 0,
  batch_id text,
  source_job_id text,
  basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_score_heads_key_unique UNIQUE (alliance_id, member_id, period, recorded_date)
);
CREATE INDEX IF NOT EXISTS vs_score_heads_scope_idx ON vs_score_heads(alliance_id, period, recorded_date);
CREATE INDEX IF NOT EXISTS vs_score_heads_batch_idx ON vs_score_heads(batch_id);
CREATE TABLE IF NOT EXISTS vs_score_revisions (
  id text PRIMARY KEY,
  head_id text NOT NULL REFERENCES vs_score_heads(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  version integer NOT NULL,
  score bigint CHECK (score >= 0 AND score <= 9007199254740991),
  origin text NOT NULL CHECK (origin IN ('hq', 'derived')),
  batch_id text,
  source_job_id text,
  basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_score_revisions_version_unique UNIQUE (head_id, version)
);
CREATE TABLE IF NOT EXISTS vs_score_submissions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  source_job_id text NOT NULL,
  request_id text NOT NULL,
  digest text NOT NULL,
  batch_id text NOT NULL,
  revision integer NOT NULL,
  row_count integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_score_submissions_request_unique UNIQUE (alliance_id, source_job_id, request_id)
);
CREATE TABLE IF NOT EXISTS vs_score_sync_scopes (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  recorded_date text NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'weekly')),
  requested_version integer NOT NULL DEFAULT 1,
  processed_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  lease_token text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  managed_member_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  managed_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT vs_score_sync_scopes_key_unique UNIQUE (alliance_id, period, recorded_date)
);
