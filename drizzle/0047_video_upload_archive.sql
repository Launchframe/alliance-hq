-- Video upload pending state + archive storage for moderation copies
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS r2_upload_id text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS expected_file_size_bytes integer;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS archive_storage_key text;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS original_file_size_bytes bigint;
