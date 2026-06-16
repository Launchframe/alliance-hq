CREATE TABLE IF NOT EXISTS video_job_surveys (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
  row_count_estimate integer,
  scroll_style text,
  above_average_scroll boolean,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
