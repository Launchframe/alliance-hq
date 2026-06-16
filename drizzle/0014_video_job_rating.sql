ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS rating text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS rating_at timestamptz;

ALTER TABLE parsed_rows ADD COLUMN IF NOT EXISTS manually_added integer NOT NULL DEFAULT 0;
