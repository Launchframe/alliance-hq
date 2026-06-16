ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS quality_score float;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS quality_bucket text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS quality_computed_at timestamptz;
