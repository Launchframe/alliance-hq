CREATE TABLE IF NOT EXISTS video_upload_groups (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  alliance_id text,
  storage_key text,
  file_name text,
  file_size_bytes bigint,
  score_target text,
  board_key text,
  hq_event_id text,
  primary_job_id text,
  selected_job_id text,
  accuracy_job_id text,
  comparison_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS group_id text REFERENCES video_upload_groups(id) ON DELETE CASCADE;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS pass_key text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS pass_index integer;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS pass_role text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS extraction_config_json jsonb;

CREATE INDEX IF NOT EXISTS idx_video_jobs_group_id ON video_jobs(group_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_pass_role ON video_jobs(pass_role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_jobs_group_pass_key ON video_jobs(group_id, pass_key) WHERE group_id IS NOT NULL;
